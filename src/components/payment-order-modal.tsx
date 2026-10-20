"use client";

import { useEffect, useMemo, useState } from "react";
import { CreditCard, X } from "lucide-react";
import { DateInput, MoneyInput, SearchSelect, type Option } from "@/components/fields";
import { CashAccountSelect } from "@/components/cash-account-select";
import { useLedgerAccountCodes, useLedgerAccounts } from "@/components/ledger-account";
import { date, money, todayIso } from "@/lib/format";
import { companyOf } from "@/lib/companies";
import { downloadPaymentOrderPdf, paymentMethodLabels, type PaymentOrderPdfData } from "@/lib/payment-order-pdf";
import type { PendingVoucher } from "@/lib/payment-order-service";

type Payment = Record<string, unknown> & { _id: string };
type Pick = { mode: "total" | "parcial"; pesos: number };

/** GGI y bienes de uso son de la empresa: no van a una obra. */
const WORKLESS = new Set(["GGI", "BB"]);
const dayOf = (value: unknown) => value ? new Date(String(value)).toISOString().slice(0, 10) : "";

/**
 * La orden de pago de Tesorería: se elige el proveedor y aparecen sus facturas
 * y notas de débito con saldo y sus notas de crédito. De cada factura se paga
 * el total o una parte, y las notas de crédito restan. Lleva el tipo de gasto,
 * la obra si corresponde y de qué caja sale. Al guardar se baja el PDF.
 */
export function PaymentOrderModal({ payment, suppliers, works, initialSupplierId = "", initialExpenseId = "", onClose, onSaved }: {
  payment?: Payment | null; suppliers: Option[]; works: Option[]; initialSupplierId?: string; initialExpenseId?: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [supplierId, setSupplierId] = useState(String(payment?.supplierId || initialSupplierId));
  const [rows, setRows] = useState<PendingVoucher[] | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  // `version` remonta los importes cuando cambian desde afuera (Total, Limpiar).
  const [version, setVersion] = useState(0);
  const [orderDate, setOrderDate] = useState(dayOf(payment?.date) || todayIso());
  const [execute, setExecute] = useState(payment ? payment.status !== "emitida" : true);
  const [method, setMethod] = useState(String(payment?.method || "transferencia"));
  const [accountId, setAccountId] = useState(String(payment?.accountId || ""));
  const [workId, setWorkId] = useState(String(payment?.workId || ""));
  const [retentions, setRetentions] = useState(Number(payment?.retentionsCents || 0) / 100);
  const [check, setCheck] = useState({ number: "", bank: "", dueDate: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accounts = useLedgerAccounts("egreso");
  const codes = useLedgerAccountCodes();
  const workless = WORKLESS.has(codes[accountId] || "");
  const accountChanged = Boolean(payment?.accountId) && accountId !== String(payment?.accountId || "");
  const paysWithCheck = method === "cheque" || method === "echeq";

  // El cheque que ya tiene la OP, para editarlo.
  useEffect(() => {
    if (!payment?.checkId) return;
    void fetch(`/api/records/checks/${String(payment.checkId)}`).then(response => response.ok ? response.json() : null).then(row => {
      if (row) setCheck({ number: String(row.number || ""), bank: String(row.bank || ""), dueDate: dayOf(row.dueDate) });
    }).catch(() => undefined);
  }, [payment?.checkId]);

  useEffect(() => {
    if (!supplierId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ supplierId, ...(payment ? { payment: payment._id } : {}) });
    fetch(`/api/payment-orders?${query.toString()}`, { signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudieron traer los comprobantes"); return body.items as PendingVoucher[]; })
      .then(items => {
        setRows(items);
        // Al editar vuelve lo que la OP ya había aplicado; desde una factura, se propone pagarla entera.
        setPicks(Object.fromEntries(items.flatMap(item => item.appliedCents
          ? [[item._id, { mode: item.credit || item.appliedCents < item.balanceCents ? "parcial" : "total", pesos: item.appliedCents / 100 } satisfies Pick]]
          : item._id === initialExpenseId ? [[item._id, { mode: "total", pesos: item.balanceCents / 100 } satisfies Pick]] : [])));
        setVersion(current => current + 1);
        const first = items.find(item => item._id === initialExpenseId && item.workId);
        if (first && !payment) setWorkId(current => current || first.workId);
      })
      .catch(problem => { if (!controller.signal.aborted) { setRows([]); setError(problem instanceof Error ? problem.message : "No se pudieron traer los comprobantes"); } });
    return () => controller.abort();
  }, [supplierId, payment, initialExpenseId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const debits = useMemo(() => (rows || []).filter(row => !row.credit), [rows]);
  const credits = useMemo(() => (rows || []).filter(row => row.credit), [rows]);
  const cents = (row: PendingVoucher) => {
    const pick = picks[row._id];
    if (!pick) return 0;
    return pick.mode === "total" && !row.credit ? row.balanceCents : Math.round(pick.pesos * 100);
  };
  const debitCents = debits.reduce((total, row) => total + cents(row), 0);
  const creditCents = credits.reduce((total, row) => total + cents(row), 0);
  const amountCents = debitCents - creditCents;
  const retentionsCents = Math.round(retentions * 100);
  const over = (rows || []).find(row => cents(row) > row.balanceCents);

  function toggle(row: PendingVoucher, on: boolean) {
    setPicks(current => {
      const next = { ...current };
      if (on) next[row._id] = { mode: row.credit ? "parcial" : "total", pesos: row.balanceCents / 100 }; else delete next[row._id];
      return next;
    });
    // Elegir una factura de obra completa la obra, si el gasto puede ir a una.
    if (on && row.workId && !workless) setWorkId(current => current || row.workId);
    setVersion(current => current + 1);
  }

  function setMode(row: PendingVoucher, mode: Pick["mode"]) {
    setPicks(current => ({ ...current, [row._id]: { mode, pesos: mode === "total" ? row.balanceCents / 100 : current[row._id]?.pesos ?? row.balanceCents / 100 } }));
    setVersion(current => current + 1);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!orderDate) return setError("Poné la fecha de la orden de pago");
    if (over) return setError(over.credit ? `La ${over.label} tiene ${money(over.balanceCents)} para descontar` : `A la ${over.label} le quedan ${money(over.balanceCents)} por pagar`);
    if (debitCents <= 0) return setError("Elegí al menos una factura (o nota de débito) para pagar");
    if (creditCents > debitCents) return setError("Las notas de crédito no pueden pasar de lo que se paga");
    if (!accountId) return setError("Elegí el tipo de gasto");
    if (retentionsCents > amountCents) return setError("Las retenciones no pueden pasar del importe de la orden de pago");
    const cashAccountId = String(form.get("cashAccountId") || "");
    if (execute && !cashAccountId) return setError("Elegí de qué caja o cuenta sale la plata");
    if (execute && paysWithCheck && (!check.number.trim() || !check.bank.trim() || !check.dueDate)) return setError("Poné el número, el banco y la fecha de cobro del cheque");
    setBusy(true); setError("");
    const allocations = (rows || []).map(row => ({ expenseId: row._id, amountCents: cents(row) })).filter(allocation => allocation.amountCents > 0);
    const response = await fetch(payment ? `/api/payment-orders/${payment._id}` : "/api/payment-orders", {
      method: payment ? "PUT" : "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        supplierId, date: orderDate, dueDate: execute ? "" : String(form.get("dueDate") || ""), execute, method, cashAccountId,
        accountId, accountChangeReason: String(form.get("accountChangeReason") || ""), workId: workless ? "" : workId,
        retentionsCents, reference: String(form.get("reference") || ""), notes: String(form.get("notes") || ""),
        check: paysWithCheck && check.number.trim() && check.bank.trim() && check.dueDate ? check : undefined,
        allocations,
      }),
    });
    const result = await response.json();
    if (!response.ok) { setBusy(false); return setError(result.error || "No se pudo guardar la orden de pago"); }
    try { await downloadPaymentOrderPdf(result.pdf as PaymentOrderPdfData); } catch { /* la OP ya quedó guardada: el PDF se baja desde la lista */ }
    onSaved();
  }

  const voucherCell = (row: PendingVoucher) => <td data-label="Comprobante"><b>{row.label}</b><span className={`company-badge ${row.company}`}>{companyOf(row.company).short}</span>
    {(row.description || row.receiptRef) && <small className="muted-line">{[row.receiptRef && `Remito ${row.receiptRef}`, row.description].filter(Boolean).join(" · ")}</small>}
    {row.notice && <small className="warning-line">{row.notice}</small>}</td>;

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal receipt-modal payment-order-modal" role="dialog" aria-modal="true" aria-labelledby="payment-order-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><CreditCard /></span><div>
        <p className="eyebrow">{payment ? `ORDEN DE PAGO ${String(payment.number || "")}` : "NUEVA ORDEN DE PAGO"}</p>
        <h2 id="payment-order-title">{payment ? "Editar orden de pago" : "Pagar a un proveedor"}</h2>
        <small>Elegí el proveedor, qué facturas pagás (todo o una parte) y qué notas de crédito descontás. Al guardar se baja la OP en PDF.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={event => { void save(event); }}>
        <div className="modal-form-body">
          <div className="form-grid">
            <label><span>Proveedor *</span><SearchSelect name="supplierId" options={suppliers} value={supplierId} onChange={value => { setSupplierId(value); setRows(null); setPicks({}); }} required placeholder="Elegí el proveedor…" /></label>
            <label><span>Fecha *</span><DateInput name="date" defaultValue={orderDate} required recent onValueChange={setOrderDate} /></label>
            <label><span>Tipo de gasto *<em className="field-hint">La cuenta del plan: CC, GGD, GGI, bienes de uso…</em></span><SearchSelect name="accountId" options={accounts} value={accountId} onChange={value => { setAccountId(value); if (WORKLESS.has(codes[value] || "")) setWorkId(""); }} required placeholder="Elegí el tipo de gasto…" /></label>
            {accountChanged && <label><span>Motivo del cambio de cuenta *<em className="field-hint">Queda en el historial de la imputación</em></span><input name="accountChangeReason" required /></label>}
            <label><span>Obra<em className="field-hint">{workless ? "Un GGI o un bien de uso no va a una obra" : "Para CC y GGD; vacía si es para el depósito"}</em></span>
              {workless ? <input value="No va a una obra" disabled readOnly /> : <SearchSelect name="workId" options={works} value={workId} onChange={setWorkId} placeholder="Sin obra" />}</label>
            <label><span>Pago *</span><select value={execute ? "ahora" : "emitida"} onChange={event => setExecute(event.target.value === "ahora")}>
              <option value="ahora">Pagarla ahora</option><option value="emitida">Dejarla emitida, se paga al vencimiento</option>
            </select></label>
            {!execute && <label><span>Vencimiento</span><DateInput name="dueDate" defaultValue={dayOf(payment?.dueDate)} hideToday quickRanges={[7, 15, 30]} /></label>}
            <label><span>Medio de pago *</span><select value={method} onChange={event => setMethod(event.target.value)}>
              {Object.entries(paymentMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label><span>Caja / cuenta bancaria{execute ? " *" : ""}<em className="field-hint">De dónde sale la plata</em></span><CashAccountSelect name="cashAccountId" defaultValue={String(payment?.cashAccountId || "")} required={execute} /></label>
            {paysWithCheck && <>
              <label><span>N° de {method === "echeq" ? "e-Cheq" : "cheque"}{execute ? " *" : ""}</span><input value={check.number} onChange={event => setCheck(current => ({ ...current, number: event.target.value }))} /></label>
              <label><span>Banco{execute ? " *" : ""}</span><input value={check.bank} onChange={event => setCheck(current => ({ ...current, bank: event.target.value }))} placeholder="Banco de Corrientes…" /></label>
              <label><span>Fecha de cobro{execute ? " *" : ""}</span><input type="date" value={check.dueDate} onChange={event => setCheck(current => ({ ...current, dueDate: event.target.value }))} /></label>
            </>}
            <label><span>Retenciones</span><MoneyInput name="retentionsCents" defaultValue={retentions} onValueChange={setRetentions} /></label>
            <label><span>Referencia</span><input name="reference" defaultValue={String(payment?.reference || "")} placeholder="N° de transferencia…" /></label>
          </div>

          {!supplierId ? <div className="empty-state compact"><p>Elegí el proveedor para ver sus facturas pendientes.</p></div>
            : rows === null ? <div className="loading-state">Buscando sus comprobantes…</div>
              : !debits.length ? <div className="empty-state compact"><p>Este proveedor no tiene facturas pendientes de pago.</p></div>
                : <>
                  <div className="receipt-table-head"><b>Facturas y notas de débito pendientes</b><span>
                    <button type="button" className="link-btn" onClick={() => { setPicks(current => ({ ...Object.fromEntries(Object.entries(current).filter(([key]) => credits.some(row => row._id === key))), ...Object.fromEntries(debits.map(row => [row._id, { mode: "total", pesos: row.balanceCents / 100 } satisfies Pick])) })); setVersion(current => current + 1); }}>Pagar todas</button>
                    <button type="button" className="link-btn" onClick={() => { setPicks({}); setVersion(current => current + 1); }}>Limpiar</button>
                  </span></div>
                  <div className="table-scroll"><table className="receipt-table"><thead><tr><th aria-label="Elegir" /><th>Comprobante</th><th>Fecha / vto.</th><th>OC / obra</th><th>Total</th><th>Saldo</th><th>Paga</th><th>Importe</th><th>Queda</th></tr></thead><tbody>
                    {debits.map(row => {
                      const pick = picks[row._id];
                      const paying = cents(row);
                      const overdue = row.dueDate && new Date(row.dueDate) < new Date(`${todayIso()}T00:00:00.000Z`);
                      return <tr key={row._id} className={paying > row.balanceCents ? "row-alert" : ""}>
                        <td data-label="Elegir"><input type="checkbox" checked={Boolean(pick)} onChange={event => toggle(row, event.target.checked)} aria-label={`Pagar ${row.label}`} /></td>
                        {voucherCell(row)}
                        <td data-label="Fecha / vto.">{row.issueDate ? date(row.issueDate) : "—"}{row.dueDate && <small className={overdue ? "warning-line" : "muted-line"}>vence {date(row.dueDate)}</small>}</td>
                        <td data-label="OC / obra">{[row.orderNumber, row.workLabel].filter(Boolean).join(" · ") || "—"}</td>
                        <td data-label="Total">{money(row.amountCents)}</td>
                        <td data-label="Saldo">{money(row.balanceCents)}</td>
                        <td data-label="Paga"><select value={pick?.mode || "total"} disabled={!pick} onChange={event => setMode(row, event.target.value as Pick["mode"])}><option value="total">Total</option><option value="parcial">Parcial</option></select></td>
                        <td data-label="Importe"><div className="receipt-apply">
                          {pick?.mode === "parcial"
                            ? <MoneyInput key={`${row._id}-${version}`} name={`apply-${row._id}`} defaultValue={pick.pesos} onValueChange={value => setPicks(current => ({ ...current, [row._id]: { mode: "parcial", pesos: value } }))} />
                            : <span>{pick ? money(row.balanceCents) : "—"}</span>}
                        </div></td>
                        <td data-label="Queda">{pick ? money(Math.max(0, row.balanceCents - paying)) : "—"}</td>
                      </tr>;
                    })}
                  </tbody></table></div>

                  {credits.length > 0 && <>
                    <div className="receipt-table-head"><b>Notas de crédito para descontar</b></div>
                    <div className="table-scroll"><table className="receipt-table"><thead><tr><th aria-label="Elegir" /><th>Comprobante</th><th>Fecha</th><th>Total</th><th>Disponible</th><th>Se descuenta</th></tr></thead><tbody>
                      {credits.map(row => {
                        const pick = picks[row._id];
                        return <tr key={row._id} className={cents(row) > row.balanceCents ? "row-alert" : ""}>
                          <td data-label="Elegir"><input type="checkbox" checked={Boolean(pick)} onChange={event => toggle(row, event.target.checked)} aria-label={`Descontar ${row.label}`} /></td>
                          {voucherCell(row)}
                          <td data-label="Fecha">{row.issueDate ? date(row.issueDate) : "—"}</td>
                          <td data-label="Total">{money(row.amountCents)}</td>
                          <td data-label="Disponible">{money(row.balanceCents)}</td>
                          <td data-label="Se descuenta"><div className="receipt-apply">
                            {pick ? <MoneyInput key={`${row._id}-${version}`} name={`apply-${row._id}`} defaultValue={pick.pesos} onValueChange={value => setPicks(current => ({ ...current, [row._id]: { mode: "parcial", pesos: value } }))} /> : <span>—</span>}
                          </div></td>
                        </tr>;
                      })}
                    </tbody></table></div>
                  </>}
                </>}

          {debitCents > 0 && <dl className="payment-order-totals">
            <div><dt>Facturas y notas de débito</dt><dd>{money(debitCents)}</dd></div>
            {creditCents > 0 && <div><dt>Menos notas de crédito</dt><dd>- {money(creditCents)}</dd></div>}
            <div><dt>Importe de la orden de pago</dt><dd>{money(amountCents)}</dd></div>
            {retentionsCents > 0 && <div><dt>Menos retenciones</dt><dd>- {money(retentionsCents)}</dd></div>}
            <div className="total"><dt>A pagar</dt><dd>{money(Math.max(0, amountCents - retentionsCents))}</dd></div>
          </dl>}

          <label className="wide receipt-notes"><span>Observaciones</span><textarea name="notes" defaultValue={String(payment?.notes || "")} placeholder="Salen en el PDF de la orden de pago" /></label>
        </div>
        {error && <p className="form-error modal-error">{error}</p>}
        <footer><span>A pagar: <b>{money(Math.max(0, amountCents - retentionsCents))}</b></span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={busy || !supplierId}>{busy ? "Guardando…" : payment ? "Guardar y bajar el PDF" : "Emitir la OP y bajar el PDF"}</button></footer>
      </form>
    </section>
  </div>;
}
