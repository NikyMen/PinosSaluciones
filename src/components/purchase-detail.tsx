"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, CheckCircle2, ClipboardList, Download, FileText, HandCoins, PackagePlus, Paperclip, ReceiptText, Send, X, XCircle } from "lucide-react";
import { DateInput, MoneyInput, SearchSelect } from "@/components/fields";
import { CashAccountSelect } from "@/components/cash-account-select";
import { useLedgerAccounts } from "@/components/ledger-account";
import { date, dateTime, money, qty, todayIso } from "@/lib/format";
import { companyOf } from "@/lib/companies";
import { warehouseLabel } from "@/lib/warehouses";
import { orderStatusLabels, paymentTermLabels, requestStatusLabels } from "@/lib/purchase-flow-labels";
import { downloadPurchaseOrderPdf, purchaseOrderPdfData } from "@/lib/purchase-order-pdf";
import { PURCHASE_APPROVAL_LIMIT_CENTS } from "@/lib/constants";

type Doc = Record<string, unknown> & { _id: string };
type Line = { code?: string; name: string; presentation?: string; quantity: number; unitCents: number; totalCents: number; receivedQty?: number };
type Detail = {
  request: Doc | null; order: Doc | null; payments: Doc[]; receipts: Doc[]; expenses: Doc[]; supplier: Doc | null; work: Doc | null;
  totals: { totalCents: number; paidCents: number; committedCents: number; withoutOrderCents: number; pendingCents: number };
  can: { edit: boolean; emit: boolean; decide: boolean; cancel: boolean; paymentOrder: boolean; receive: boolean; invoice: boolean };
};

const paymentStatusLabels: Record<string, string> = { emitida: "Emitida, sin pagar", pagada: "Pagada", anulada: "Anulada" };
const methodLabels: Record<string, string> = { transferencia: "Transferencia", efectivo: "Efectivo", cheque: "Cheque / eCheq", otro: "Otro" };

async function upload(file: File | null) {
  if (!file || !file.size) return "";
  const form = new FormData(); form.set("file", file);
  const response = await fetch("/api/uploads", { method: "POST", body: form });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo subir el archivo");
  return String(body.path);
}

/**
 * Una compra de punta a punta: la solicitud y su orden de compra, las órdenes de
 * pago con sus comprobantes, los remitos y las facturas, con lo que puede hacer
 * quien la mira según su permiso (requerimiento integral v4, punto 2).
 */
export function PurchaseDetailModal({ purchaseId, onClose, onChanged }: { purchaseId: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"" | "pay" | "receive">("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/purchases/${purchaseId}/detail`);
    const body = await response.json();
    if (!response.ok) return setError(body.error || "No se pudo abrir la compra");
    setDetail(body as Detail);
  }, [purchaseId]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function act(path: string, body: unknown, done: string) {
    setBusy(true); setError(""); setNotice("");
    const response = await fetch(`/api/purchases/${purchaseId}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setError(result.error || "No se pudo completar"); return false; }
    setNotice(done); setPanel("");
    await load(); onChanged();
    return true;
  }

  async function emit() {
    const amount = Number(detail?.request?.amountCents || 0);
    const message = amount >= PURCHASE_APPROVAL_LIMIT_CENTS
      ? `Se emite por ${money(amount)}: desde ${money(PURCHASE_APPROVAL_LIMIT_CENTS)} la tiene que autorizar Gerencia o Presidencia. Después no se puede cambiar, sólo anular. ¿Emitir?`
      : `Se emite por ${money(amount)}: por debajo de ${money(PURCHASE_APPROVAL_LIMIT_CENTS)} queda autorizada y pasa a Tesorería. Después no se puede cambiar, sólo anular. ¿Emitir?`;
    if (confirm(message)) await act("emit", {}, "Solicitud emitida.");
  }

  async function decide(approve: boolean) {
    const reason = approve ? "" : prompt("¿Por qué se rechaza? Compras recibe el aviso con el motivo.") || "";
    if (!approve && reason.trim().length < 3) return;
    await act("decision", { approve, reason }, approve ? "Autorizada: pasa a Tesorería para la orden de pago." : "Rechazada.");
  }

  async function cancel() {
    const reason = prompt("¿Por qué se anula? Queda en el historial y en la bitácora.") || "";
    if (reason.trim().length < 3) return;
    await act("cancel", { reason }, "Anulada.");
  }

  async function pdf(doc: Doc) {
    try { await downloadPurchaseOrderPdf(purchaseOrderPdfData(doc, detail?.supplier, detail?.work)); }
    catch { setError("No se pudo generar el PDF"); }
  }

  const request = detail?.request || null;
  const order = detail?.order || null;
  const main = order || request;
  const items = ((order || request)?.items as Line[] | undefined) || [];

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal purchase-detail" role="dialog" aria-modal="true" aria-labelledby="purchase-detail-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><ClipboardList /></span><div>
        <p className="eyebrow">{order ? "ORDEN DE COMPRA" : "SOLICITUD DE COMPRA"}</p>
        <h2 id="purchase-detail-title">{main ? `${String(main.number)} · ${String(detail?.supplier?.name || "Sin proveedor")}` : "Cargando…"}</h2>
        {main && <small><span className={`company-badge ${companyOf(main.company).key}`}>{companyOf(main.company).short}</span> {String(main.description || "")}</small>}
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>

      <div className="modal-form-body">
        {error && <div className="notice error">{error}</div>}
        {notice && <div className="notice success" role="status">{notice}</div>}
        {!detail ? <div className="loading-state">Cargando…</div> : <>
          <div className="price-kpis tracking-kpis">
            <div className="stock-kpi"><span>Solicitud {request ? String(request.number) : ""}</span><strong>{request ? requestStatusLabels[String(request.status)] || String(request.status) : "—"}</strong>
              <small>{request ? `${paymentTermLabels[String(request.paymentTerms || "contado")]}${request.paymentTerms === "plazo" && request.termDays ? ` a ${String(request.termDays)} días` : ""}${request.requiresAdvance ? " · con anticipo" : ""}${request.legacyNumber ? ` · antes ${String(request.legacyNumber)}` : ""}` : "Cargada como orden"}</small></div>
            <div className="stock-kpi"><span>Orden de compra</span><strong>{order ? `${String(order.number)} · ${orderStatusLabels[String(order.status)] || String(order.status)}` : "Todavía no"}</strong>
              <small>{order ? `Recepción: ${String(order.receptionStatus || "pendiente")}` : request?.status === "autorizada" ? "La genera Tesorería con la orden de pago" : "Nace cuando Tesorería emite la orden de pago"}</small></div>
            <div className="stock-kpi"><span>Total</span><strong>{money(detail.totals.totalCents)}</strong><small>Con IVA</small></div>
            <div className={detail.totals.pendingCents > 0 && order ? "stock-kpi alert" : "stock-kpi"}><span>Pagado</span><strong>{money(detail.totals.paidCents)}</strong>
              <small>Saldo {money(detail.totals.pendingCents)}{detail.totals.committedCents > detail.totals.paidCents ? ` · ${money(detail.totals.committedCents - detail.totals.paidCents)} en OP emitidas` : ""}</small></div>
          </div>

          {/* Quién decidió qué. */}
          <ul className="purchase-decisions">
            {Boolean(request?.approval) && <li><CheckCircle2 size={14} /> {(request!.approval as Doc).automatic ? "Autorizada sola por monto" : `Autorizada por ${String((request!.approval as Doc).userName || "")}`} · {dateTime(String((request!.approval as Doc).at))}</li>}
            {Boolean(request?.rejection) && <li><XCircle size={14} /> Rechazada por {String((request!.rejection as Doc).userName || "")}: {String((request!.rejection as Doc).reason || "")}</li>}
            {Boolean(main?.cancellation) && <li><Ban size={14} /> Anulada por {String((main!.cancellation as Doc).userName || "")}: {String((main!.cancellation as Doc).reason || "")}</li>}
          </ul>

          <div className="purchase-actions">
            {request && <button type="button" className="secondary-btn" onClick={() => { void pdf(request); }}><Download size={15} /> PDF solicitud</button>}
            {order && <button type="button" className="secondary-btn" onClick={() => { void pdf(order); }}><Download size={15} /> PDF orden</button>}
            {detail.can.emit && <button type="button" className="primary-btn" disabled={busy} onClick={() => { void emit(); }}><Send size={15} /> Emitir</button>}
            {detail.can.decide && <><button type="button" className="primary-btn" disabled={busy} onClick={() => { void decide(true); }}><CheckCircle2 size={15} /> Autorizar</button>
              <button type="button" className="secondary-btn" disabled={busy} onClick={() => { void decide(false); }}><XCircle size={15} /> Rechazar</button></>}
            {detail.can.paymentOrder && <button type="button" className="primary-btn" onClick={() => setPanel(panel === "pay" ? "" : "pay")}><HandCoins size={15} /> Emitir orden de pago</button>}
            {detail.can.receive && <button type="button" className="primary-btn" onClick={() => setPanel(panel === "receive" ? "" : "receive")}><PackagePlus size={15} /> Cargar remito</button>}
            {detail.can.invoice && order && <Link className="secondary-btn" href={`/app/expenses?oc=${order._id}`}><ReceiptText size={15} /> Cargar factura</Link>}
            {detail.can.cancel && <button type="button" className="secondary-btn danger" disabled={busy} onClick={() => { void cancel(); }}><Ban size={15} /> Anular</button>}
          </div>

          {panel === "pay" && <PaymentOrderForm detail={detail} busy={busy} onSubmit={body => act("payment-order", body, "Orden de pago emitida.")} onError={setError} />}
          {panel === "receive" && order && <ReceiveForm order={order} items={items} busy={busy} onSubmit={body => act("receive", body, "Remito cargado: la mercadería sumó al stock.")} onError={setError} />}

          {items.length > 0 && <><h3 className="purchase-section">Productos</h3>
            <table className="picked-lines"><thead><tr><th>Producto</th><th>Pedido</th>{order && <th>Recibido</th>}<th>Unitario (sin IVA)</th><th>Total</th></tr></thead><tbody>
              {items.map((line, index) => <tr key={index}><td data-label="Producto">{line.name}{line.presentation ? ` · ${line.presentation}` : ""}</td><td data-label="Pedido">{qty(line.quantity)}</td>
                {order && <td data-label="Recibido">{qty(Number(line.receivedQty || 0))}</td>}<td data-label="Unitario">{money(line.unitCents)}</td><td data-label="Total">{money(line.totalCents)}</td></tr>)}
            </tbody></table></>}

          <h3 className="purchase-section">Órdenes de pago</h3>
          {!detail.payments.length ? <p className="muted">{order ? "Sin órdenes de pago." : "Tesorería todavía no emitió la orden de pago."}</p>
            : <table className="picked-lines"><thead><tr><th>OP</th><th>Estado</th><th>Fecha</th><th>Medio</th><th>Importe</th><th>Comprobante</th></tr></thead><tbody>
              {detail.payments.map(payment => <tr key={payment._id}>
                <td data-label="OP"><b>{String(payment.number || "")}</b>{payment.account ? <small className="tracking-sub">{String(payment.account)}</small> : null}</td>
                <td data-label="Estado">{paymentStatusLabels[String(payment.status)] || String(payment.status)}{payment.status === "emitida" && payment.dueDate ? <small className="tracking-sub">Vence {date(String(payment.dueDate))}</small> : null}</td>
                <td data-label="Fecha">{date(String(payment.date))}</td>
                <td data-label="Medio">{methodLabels[String(payment.method)] || String(payment.method || "")}</td>
                <td data-label="Importe">{money(Number(payment.amountCents || 0))}</td>
                <td data-label="Comprobante">{payment.attachment ? <a href={String(payment.attachment)} target="_blank" rel="noreferrer"><Paperclip size={13} /> Ver</a> : "—"}</td>
              </tr>)}
            </tbody></table>}

          <h3 className="purchase-section">Remitos</h3>
          {!detail.receipts.length ? <p className="muted">Todavía no llegó nada.</p>
            : <table className="picked-lines"><thead><tr><th>Remito</th><th>Fecha</th><th>Llegó</th><th>Estado</th><th>Archivo</th></tr></thead><tbody>
              {detail.receipts.map(receipt => <tr key={receipt._id}>
                <td data-label="Remito"><b>{String(receipt.supplierRemito || receipt.number)}</b><small className="tracking-sub">{String(receipt.number)} · {String(receipt.userName || "")}</small></td>
                <td data-label="Fecha">{date(String(receipt.date))}</td>
                <td data-label="Llegó">{((receipt.lines as Array<{ name: string; quantity: number; unit?: string }>) || []).map(line => `${qty(line.quantity)} ${line.unit || ""} ${line.name}`).join(" · ") || "—"}<small className="tracking-sub">{warehouseLabel(String(receipt.warehouse || "central"))}</small></td>
                <td data-label="Estado">{receipt.status === "observada" ? `Observada: ${String(receipt.notes || "")}` : "Conforme"}{receipt.final ? <small className="tracking-sub">Final</small> : null}</td>
                <td data-label="Archivo">{receipt.attachment ? <a href={String(receipt.attachment)} target="_blank" rel="noreferrer"><Paperclip size={13} /> Ver</a> : "—"}</td>
              </tr>)}
            </tbody></table>}

          {detail.expenses.length > 0 && <><h3 className="purchase-section">Facturas del proveedor</h3>
            <ul className="purchase-decisions">{detail.expenses.map(expense => <li key={expense._id}><FileText size={14} /> {String(expense.number || "Sin número")} · {money(Number(expense.amountCents || 0))} · {String(expense.status || "")}</li>)}</ul></>}

          {Array.isArray(main?.history) && <><h3 className="purchase-section">Historia</h3>
            <ul className="purchase-history">{[...(request?.history as Doc[] || []), ...(order && order !== request ? order.history as Doc[] || [] : [])]
              .sort((a, b) => String(a.at).localeCompare(String(b.at))).map((entry, index) => <li key={index}><b>{String(entry.action)}</b>{entry.note ? `: ${String(entry.note)}` : ""}<small>{dateTime(String(entry.at))} · {String(entry.userName || "")}</small></li>)}</ul></>}
        </>}
      </div>
    </section>
  </div>;
}

/** La orden de pago de Tesorería: con la primera nace la OC. Se paga ahora o queda emitida con su vencimiento. */
function PaymentOrderForm({ detail, busy, onSubmit, onError }: { detail: Detail; busy: boolean; onSubmit: (body: Record<string, unknown>) => Promise<boolean>; onError: (message: string) => void }) {
  const source = detail.order || detail.request;
  const terms = String(source?.paymentTerms || "contado");
  const [amount, setAmount] = useState(detail.totals.withoutOrderCents / 100);
  const [execute, setExecute] = useState(terms === "contado" || Boolean(source?.requiresAdvance));
  const [method, setMethod] = useState("transferencia");
  const [accountId, setAccountId] = useState("");
  const accounts = useLedgerAccounts("egreso");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const attachment = await upload(form.get("attachment") as File | null);
      await onSubmit({
        amountCents: Math.round(amount * 100), date: String(form.get("date") || todayIso()), dueDate: String(form.get("dueDate") || ""), method,
        accountId, cashAccountId: String(form.get("cashAccountId") || ""), execute, reference: String(form.get("reference") || ""), notes: String(form.get("notes") || ""), attachment,
      });
    } catch (problem) { onError(problem instanceof Error ? problem.message : "No se pudo subir el comprobante"); }
  }

  return <form className="purchase-panel" onSubmit={event => { void submit(event); }}>
    <p className="eyebrow">ORDEN DE PAGO {detail.order ? `DE ${String(detail.order.number)}` : "· GENERA LA ORDEN DE COMPRA"}</p>
    <div className="form-grid">
      <label><span>Importe *<em className="field-hint">Sin OP quedan {money(detail.totals.withoutOrderCents)}</em></span><MoneyInput name="amountCents" defaultValue={amount} required onValueChange={setAmount} /></label>
      <label><span>Fecha *</span><DateInput name="date" defaultValue={todayIso()} required recent /></label>
      <label><span>Medio *</span><select value={method} onChange={event => setMethod(event.target.value)}>{Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Cuenta del plan *<em className="field-hint">Egresos</em></span><SearchSelect name="accountId" options={accounts} value={accountId} onChange={setAccountId} required placeholder="Elegí la cuenta…" /></label>
      <label className="wide invoice-expenses-check"><input type="checkbox" checked={execute} onChange={event => setExecute(event.target.checked)} />
        <span><b>Pagarla ahora</b><small>{execute ? "Queda pagada, con su caja y su comprobante" : `Queda emitida: se paga al vencimiento (${paymentTermLabels[terms]})`}</small></span></label>
      {execute ? <>
        <label><span>Caja / cuenta *</span><CashAccountSelect name="cashAccountId" company={String(source?.company || "")} required /></label>
        <label><span>Comprobante<em className="field-hint">{method === "efectivo" ? "La constancia de entrega firmada" : "Transferencia, cheque, depósito"}</em></span><input type="file" name="attachment" accept="image/*,application/pdf" /></label>
      </> : <label><span>Vencimiento<em className="field-hint">Vacío: según la condición</em></span><DateInput name="dueDate" hideToday /></label>}
      <label><span>Referencia</span><input name="reference" placeholder="N° de transferencia, de cheque…" /></label>
      <label className="wide"><span>Notas</span><input name="notes" /></label>
    </div>
    <footer><button className="primary-btn" disabled={busy}>{busy ? "Guardando…" : detail.order ? "Emitir la orden de pago" : "Emitir la orden de pago y generar la OC"}</button></footer>
  </form>;
}

/** El remito del proveedor: cuánto llegó de cada producto. El final cierra la orden. */
function ReceiveForm({ order, items, busy, onSubmit, onError }: { order: Doc; items: Line[]; busy: boolean; onSubmit: (body: Record<string, unknown>) => Promise<boolean>; onError: (message: string) => void }) {
  const pending = items.map(line => Math.max(0, Math.round((Number(line.quantity || 0) - Number(line.receivedQty || 0)) * 1000) / 1000));
  const [quantities, setQuantities] = useState<string[]>(() => pending.map(value => String(value).replace(".", ",")));
  const [status, setStatus] = useState<"conforme" | "observada">("conforme");
  const parsed = quantities.map(value => Number(String(value).replace(",", ".")) || 0);
  const all = items.length > 0 && parsed.every((value, index) => value >= pending[index] - 1e-9);
  const [final, setFinal] = useState(true);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const attachment = await upload(form.get("attachment") as File | null);
      await onSubmit({
        supplierRemito: String(form.get("supplierRemito") || ""), date: String(form.get("date") || todayIso()), status, notes: String(form.get("notes") || ""), attachment,
        lines: items.length ? parsed.map((quantity, line) => ({ line, quantity })).filter(entry => entry.quantity > 0) : [],
        final: items.length ? all || final : final,
      });
    } catch (problem) { onError(problem instanceof Error ? problem.message : "No se pudo subir el remito"); }
  }

  return <form className="purchase-panel" onSubmit={event => { void submit(event); }}>
    <p className="eyebrow">REMITO DEL PROVEEDOR · {String(order.number)} · ENTRA AL {warehouseLabel(order.deliverTo === "salon" ? "salon" : "central").toUpperCase()}</p>
    <div className="form-grid">
      <label><span>N° de remito del proveedor</span><input name="supplierRemito" placeholder="0001-00001234" /></label>
      <label><span>Fecha *</span><DateInput name="date" defaultValue={todayIso()} required recent /></label>
      <label><span>Cómo llegó</span><select value={status} onChange={event => setStatus(event.target.value as "conforme" | "observada")}><option value="conforme">Conforme</option><option value="observada">Con observaciones</option></select></label>
      <label><span>Remito escaneado</span><input type="file" name="attachment" accept="image/*,application/pdf" /></label>
      {status === "observada" && <label className="wide"><span>Observaciones *</span><input name="notes" required placeholder="Qué faltó, qué llegó roto…" /></label>}
    </div>
    {items.length > 0 ? <table className="picked-lines"><thead><tr><th>Producto</th><th>Falta recibir</th><th>Llegó</th></tr></thead><tbody>
      {items.map((line, index) => <tr key={index}><td>{line.name}</td><td>{qty(pending[index])}</td>
        <td><input inputMode="decimal" value={quantities[index]} disabled={pending[index] <= 0} onChange={event => setQuantities(current => current.map((value, position) => position === index ? event.target.value.replace(/[^\d,.]/g, "") : value))} aria-label={`Cuánto llegó de ${line.name}`} /></td></tr>)}
    </tbody></table> : <p className="invoice-note">Esta orden se cargó sin productos: el remito queda registrado y la mercadería se suma desde Stock.</p>}
    <label className="invoice-expenses-check"><input type="checkbox" checked={items.length ? all || final : final} disabled={items.length > 0 && all} onChange={event => setFinal(event.target.checked)} />
      <span><b>Remito final</b><small>{all ? "Con esto llega todo: la orden se cierra" : "Cierra la orden aunque falte algo (lo que no llegó no se recibe más)"}</small></span></label>
    <footer><button className="primary-btn" disabled={busy}>{busy ? "Guardando…" : "Cargar el remito"}</button></footer>
  </form>;
}
