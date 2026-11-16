"use client";

import { useEffect, useMemo, useState } from "react";
import { CreditCard, X } from "lucide-react";
import { DateInput, MoneyInput, SearchSelect, type Option } from "@/components/fields";
import { CashLinesEditor, lineProblem, linesCents, linesFrom, linesPayload, newLine, type EditableLine } from "@/components/cash-lines-editor";
import { useLedgerAccountCodes, useLedgerAccounts } from "@/components/ledger-account";
import { date, money, todayIso } from "@/lib/format";
import { COMPANIES, COMPANY_KEYS, companyOf } from "@/lib/companies";
import { downloadPaymentOrderPdf, type PaymentOrderPdfData } from "@/lib/payment-order-pdf";
import type { OnAccountPayment, PendingVoucher } from "@/lib/payment-order-service";
import { paymentMediumProblem } from "@/lib/payment-order-media";
import type { CarteraCheck } from "@/lib/check-service";

type Payment = Record<string, unknown> & { _id: string };
type Pick = { mode: "total" | "parcial"; pesos: number };

/** GGI y bienes de uso son de la empresa: no van a una obra. */
const WORKLESS = new Set(["GGI", "BB"]);
const dayOf = (value: unknown) => value ? new Date(String(value)).toISOString().slice(0, 10) : "";

/**
 * La orden de pago de Tesorería: se elige el proveedor y aparecen sus facturas
 * y notas de débito con saldo y sus notas de crédito. De cada factura se paga
 * el total o una parte, y las notas de crédito restan. Lleva el tipo de gasto,
 * la obra si corresponde y con qué se paga: uno o varios medios, cada uno de su
 * caja o cuenta (anexo de Tesorería v5.1). No lleva retenciones: la empresa no es
 * agente de retención. Al guardar se baja el PDF.
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
  // Ya no se elige "pagarla ahora o dejarla emitida": se pone la fecha en que se pagó (Tesorería, 10/11/2026).
  // Una OP que ya estaba emitida sigue así al editarla.
  const [execute] = useState(payment ? payment.status !== "emitida" : true);
  const [accountId, setAccountId] = useState(String(payment?.accountId || ""));
  const [workId, setWorkId] = useState(String(payment?.workId || ""));
  const [lines, setLines] = useState<EditableLine[]>(() => payment ? [] : [newLine()]);
  const [cartera, setCartera] = useState<CarteraCheck[]>([]);
  // Lo que se paga sin factura (a cuenta) y, si no hay facturas elegidas, qué empresa paga.
  const [onAccount, setOnAccount] = useState(() => Number(payment?.onAccountCents || 0) / 100);
  const [payCompany, setPayCompany] = useState(() => String(payment?.company || ""));
  // Las otras OP del proveedor con plata a cuenta, para no pagar dos veces.
  const [otherOnAccount, setOtherOnAccount] = useState<OnAccountPayment[]>([]);
  // Al editar una OP que tiene plata a cuenta, elegir una factura la paga con eso: el total no cambia.
  const applyingOnAccount = Number(payment?.onAccountCents || 0) > 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accounts = useLedgerAccounts("egreso");
  const codes = useLedgerAccountCodes();

  // Los medios que ya tiene la OP, con sus cheques propios, para editarlos.
  useEffect(() => {
    if (!payment) return;
    const saved = Array.isArray(payment.lines) && payment.lines.length ? payment.lines as Array<Record<string, unknown>> : [{ checkId: payment.checkId }];
    const ids = saved.map(line => line.checkId).filter(Boolean).map(String);
    void Promise.all(ids.map(id => fetch(`/api/records/checks/${id}`).then(response => response.ok ? response.json() : null).catch(() => null))).then(rows => {
      const checks = Object.fromEntries(rows.filter(Boolean).map(row => [String(row._id), { number: String(row.number || ""), bank: String(row.bank || ""), dueDate: dayOf(row.dueDate) }]));
      setLines(linesFrom(payment, Number(payment.amountCents || 0), checks));
    });
  }, [payment]);

  // Los cheques de terceros en cartera, para endosar.
  useEffect(() => {
    void fetch(`/api/checks${payment ? `?payment=${payment._id}` : ""}`).then(response => response.ok ? response.json() : { items: [] }).then(body => setCartera(body.items || [])).catch(() => undefined);
  }, [payment]);

  useEffect(() => {
    if (!supplierId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ supplierId, ...(payment ? { payment: payment._id } : {}) });
    fetch(`/api/payment-orders?${query.toString()}`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudieron traer los comprobantes");
        setOtherOnAccount(Array.isArray(body.onAccount) ? body.onAccount : []);
        return body.items as PendingVoucher[];
      })
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
  const onAccountCents = Math.max(0, Math.round(onAccount * 100));
  // Lo que cancela de los comprobantes más lo que queda a cuenta.
  const amountCents = debitCents - creditCents + onAccountCents;
  const over = (rows || []).find(row => cents(row) > row.balanceCents);
  // El tipo de gasto y la obra salen de la factura elegida (Tesorería, 10/11/2026). Sin factura (a cuenta) se eligen.
  const invoiceAccount = debits.find(row => picks[row._id] && row.accountId)?.accountId || "";
  const effectiveAccount = invoiceAccount || accountId;
  const invoiceWork = debits.find(row => picks[row._id] && row.workId);
  const workless = WORKLESS.has(codes[effectiveAccount] || "");
  const accountChanged = Boolean(payment?.accountId) && effectiveAccount !== String(payment?.accountId || "");
  // La empresa de la OP: la de los comprobantes elegidos o, toda a cuenta, la que se eligió.
  const voucherCompany = (rows || []).find(row => picks[row._id])?.company;
  const company = voucherCompany || payCompany || undefined;

  function toggle(row: PendingVoucher, on: boolean) {
    // Editando una OP con plata a cuenta, la factura se paga con eso (y al sacarla, vuelve a cuenta).
    if (applyingOnAccount && !row.credit) {
      const taken = on ? Math.min(row.balanceCents, onAccountCents) : cents(row);
      if (taken > 0) setOnAccount(Math.max(0, onAccountCents + (on ? -taken : taken)) / 100);
      setPicks(current => {
        const next = { ...current };
        if (on) next[row._id] = taken > 0 && taken < row.balanceCents ? { mode: "parcial", pesos: taken / 100 } : { mode: "total", pesos: row.balanceCents / 100 }; else delete next[row._id];
        return next;
      });
      if (on && row.workId && !workless) setWorkId(current => current || row.workId);
      setVersion(current => current + 1);
      return;
    }
    setPicks(current => {
      const next = { ...current };
      if (on) next[row._id] = { mode: row.credit ? "parcial" : "total", pesos: row.balanceCents / 100 }; else delete next[row._id];
      return next;
    });
    // Elegir una factura de obra completa la obra, si el gasto puede ir a una.
    if (on && row.workId && !workless) setWorkId(current => current || row.workId);
    setVersion(current => current + 1);
  }

  /**
   * Un cheque de terceros se endosa entero: si vale más de lo que se paga, la
   * diferencia queda a cuenta del proveedor (reunión con Tesorería, 10/11/2026).
   */
  function changeLines(next: EditableLine[]) {
    const chosen = (list: EditableLine[]) => list.filter(line => line.method === "cheque_tercero" && line.checkId).map(line => line.checkId).join(",");
    if (chosen(next) && chosen(next) !== chosen(lines)) {
      const inLines = next.length === 1 ? Math.round(next[0].pesos * 100) : linesCents(next);
      const excess = inLines - (debitCents - creditCents);
      if (excess > 0) { setOnAccount(excess / 100); setVersion(current => current + 1); }
    }
    setLines(next);
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
    if (debitCents <= 0 && onAccountCents <= 0) return setError("Elegí al menos una factura (o nota de débito) para pagar, o poné cuánto se paga a cuenta");
    if (creditCents > debitCents) return setError("Las notas de crédito no pueden pasar de lo que se paga");
    if (!company) return setError("Elegí qué empresa paga");
    if (!effectiveAccount) return setError("Elegí el tipo de gasto");
    const paying = execute && amountCents > 0;
    if (paying && lines.length > 1 && linesCents(lines) !== amountCents) return setError(`Los medios suman ${money(linesCents(lines))} y la orden de pago es de ${money(amountCents)}`);
    // Para pagarla, cada medio lleva todo lo que muestra (Administración, noviembre 2026); lo mismo controla la API.
    // Una OP de antes con el comprobante guardado en la OP (no en el medio) lo sigue teniendo.
    const legacyFiles = Boolean(payment?.attachment) || (Array.isArray(payment?.files) && payment.files.length > 0);
    const problem = paying
      ? lines.map((line, index) => {
        const missing = paymentMediumProblem({
          method: line.method, amountCents: lines.length === 1 ? amountCents : Math.round(line.pesos * 100), hasAccount: Boolean(line.cashAccountId),
          reference: line.reference, check: line.check, checkId: line.checkId, hasAttachment: Boolean(line.file || line.attachment) || legacyFiles,
        }, lines.length > 1);
        return missing && lines.length > 1 ? `Medio ${index + 1}: ${missing}` : missing;
      }).find(Boolean)
      : lines.map(line => lineProblem(line, "pago", false)).find(Boolean);
    if (problem) return setError(problem);
    setBusy(true); setError("");
    const allocations = (rows || []).map(row => ({ expenseId: row._id, amountCents: cents(row) })).filter(allocation => allocation.amountCents > 0);
    let payload;
    try { payload = await linesPayload(lines, "pago", amountCents); } catch (problem) { setBusy(false); return setError(problem instanceof Error ? problem.message : "No se pudo subir el comprobante"); }
    const response = await fetch(payment ? `/api/payment-orders/${payment._id}` : "/api/payment-orders", {
      method: payment ? "PUT" : "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        supplierId, date: orderDate, dueDate: execute ? "" : String(form.get("dueDate") || ""), execute,
        accountId: effectiveAccount, accountChangeReason: String(form.get("accountChangeReason") || ""), workId: workless ? "" : invoiceWork?.workId || workId,
        notes: String(form.get("notes") || ""), lines: payload, allocations, onAccountCents, company: voucherCompany ? undefined : company,
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
        <small>Elegí el proveedor, qué facturas pagás (todo o una parte) y qué notas de crédito descontás. Sin factura todavía, se paga a cuenta. Al guardar se baja la OP en PDF.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={event => { void save(event); }}>
        <div className="modal-form-body">
          <div className="form-grid">
            <label><span>Proveedor *</span><SearchSelect name="supplierId" options={suppliers} value={supplierId} onChange={value => { setSupplierId(value); setRows(null); setPicks({}); }} required placeholder="Elegí el proveedor…" /></label>
            <label><span>Fecha de pago *<em className="field-hint">El día que se pagó: puede ser de antes</em></span><DateInput name="date" defaultValue={orderDate} required recent onValueChange={setOrderDate} /></label>
            {/* Sin factura elegida (una OP a cuenta) el tipo de gasto y la obra se eligen; con factura, vienen de ella. */}
            {!invoiceAccount && <label><span>Tipo de gasto *<em className="field-hint">La cuenta del plan: CC, GGD, GGI, bienes de uso…</em></span><SearchSelect name="accountId" options={accounts} value={accountId} onChange={value => { setAccountId(value); if (WORKLESS.has(codes[value] || "")) setWorkId(""); }} required placeholder="Elegí el tipo de gasto…" /></label>}
            {accountChanged && <label><span>Motivo del cambio de cuenta *<em className="field-hint">Queda en el historial de la imputación</em></span><input name="accountChangeReason" required /></label>}
            {!invoiceWork && !invoiceAccount && <label><span>Obra<em className="field-hint">{workless ? "Un GGI o un bien de uso no va a una obra" : "Para CC y GGD; vacía si es para el depósito"}</em></span>
              {workless ? <input value="No va a una obra" disabled readOnly /> : <SearchSelect name="workId" options={works} value={workId} onChange={setWorkId} placeholder="Sin obra" />}</label>}
            {(invoiceAccount || invoiceWork) && <p className="invoice-note wide">De la factura: {[accounts.find(option => option.value === effectiveAccount)?.label, !workless && invoiceWork?.workLabel].filter(Boolean).join(" · ") || "sin tipo de gasto ni obra"}.</p>}
            {!execute && <label><span>Vencimiento<em className="field-hint">Esta OP está emitida: se paga desde la lista</em></span><DateInput name="dueDate" defaultValue={dayOf(payment?.dueDate)} hideToday quickRanges={[7, 15, 30]} /></label>}
          </div>

          {!supplierId ? <div className="empty-state compact"><p>Elegí el proveedor para ver sus facturas pendientes.</p></div>
            : rows === null ? <div className="loading-state">Buscando sus comprobantes…</div>
              : !debits.length ? <div className="empty-state compact"><p>Este proveedor no tiene facturas pendientes de pago. Si la factura todavía no llegó, se puede pagar a cuenta.</p></div>
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

          {supplierId && rows !== null && <>
            {otherOnAccount.length > 0 && <p className="invoice-note">Este proveedor ya tiene plata a cuenta: {otherOnAccount.map(other => `${money(other.onAccountCents)} en ${other.number} (${date(other.date)})`).join(", ")}. Para aplicarla a una factura, editá esa OP y elegí la factura.</p>}
            <div className="receipt-table-head"><b>A cuenta, sin factura</b></div>
            <div className="form-grid">
              <label><span>Importe a cuenta<em className="field-hint">{applyingOnAccount ? "Al elegir una factura se paga con esto" : "Un anticipo, o lo que sobra de un cheque de terceros. Después se aplica a la factura editando esta OP"}</em></span>
                <MoneyInput key={`on-account-${version}`} name="onAccount" defaultValue={onAccount} onValueChange={setOnAccount} /></label>
              {!voucherCompany && onAccountCents > 0 && <label><span>Empresa que paga *</span><select value={payCompany} onChange={event => setPayCompany(event.target.value)} required>
                <option value="">Elegí la empresa…</option>
                {COMPANY_KEYS.map(key => <option key={key} value={key}>{COMPANIES[key].legalName}</option>)}
              </select></label>}
            </div>
          </>}

          {amountCents > 0 && <dl className="payment-order-totals">
            {debitCents > 0 && <div><dt>Facturas y notas de débito</dt><dd>{money(debitCents)}</dd></div>}
            {creditCents > 0 && <div><dt>Menos notas de crédito</dt><dd>- {money(creditCents)}</dd></div>}
            {onAccountCents > 0 && <div><dt>A cuenta, sin factura</dt><dd>{money(onAccountCents)}</dd></div>}
            <div className="total"><dt>A pagar</dt><dd>{money(amountCents)}</dd></div>
          </dl>}

          {amountCents > 0 && <CashLinesEditor side="pago" lines={lines} onChange={changeLines} company={company} totalCents={amountCents} cartera={cartera} />}
          {amountCents > 0 && execute && <p className="invoice-note">Todo lo de cada medio es obligatorio: la cuenta, el importe, el N° de cheque o de transferencia, el banco, la fecha de cobro y el comprobante (el efectivo no lleva comprobante: firma quien lo recibe). Los comprobantes van detrás de la OP en el PDF.</p>}

          <label className="wide receipt-notes"><span>Observaciones</span><textarea name="notes" defaultValue={String(payment?.notes || "")} placeholder="Salen en el PDF de la orden de pago" /></label>
        </div>
        {error && <p className="form-error modal-error">{error}</p>}
        <footer><span>A pagar: <b>{money(amountCents)}</b></span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={busy || !supplierId}>{busy ? "Guardando…" : payment ? "Guardar y bajar el PDF" : "Emitir la OP y bajar el PDF"}</button></footer>
      </form>
    </section>
  </div>;
}
