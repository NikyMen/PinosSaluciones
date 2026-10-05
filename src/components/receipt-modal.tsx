"use client";

import { useEffect, useMemo, useState } from "react";
import { HandCoins, X } from "lucide-react";
import { DateInput, MoneyInput, SearchSelect, type Option } from "@/components/fields";
import { date, money, todayIso } from "@/lib/format";
import { downloadReceiptPdf, methodLabels } from "@/lib/receipt-pdf";
import type { PendingInvoice, ReceiptPdfData } from "@/lib/receipt-service";
import { companyOf } from "@/lib/companies";
import { DEFAULT_ACCOUNTS } from "@/lib/account-catalog";
import { useLedgerAccounts } from "@/components/ledger-account";

type Receipt = Record<string, unknown> & { _id: string };

/**
 * El recibo: se elige el cliente, aparecen sus facturas con saldo y se pone
 * cuánto se cobra de cada una. Al guardar se descarga el PDF. Sin facturas,
 * queda como pago a cuenta.
 */
export function ReceiptModal({ receipt, clients, initialClientId = "", initialInvoiceId = "", onClose, onSaved }: {
  receipt?: Receipt | null; clients: Option[]; initialClientId?: string; initialInvoiceId?: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [clientId, setClientId] = useState(String(receipt?.clientId || initialClientId));
  const [rows, setRows] = useState<PendingInvoice[] | null>(null);
  // Lo aplicado a cada factura, en pesos. `version` remonta los importes cuando se tocan con "Todo".
  const [applied, setApplied] = useState<Record<string, number>>({});
  const [version, setVersion] = useState(0);
  const [onAccount, setOnAccount] = useState(() => receipt && !Array.isArray(receipt.allocations) && !receipt.invoiceId ? Number(receipt.amountCents || 0) / 100 : 0);
  const [method, setMethod] = useState(String(receipt?.method || "transferencia"));
  const [receiptDate, setReceiptDate] = useState(receipt?.date ? new Date(String(receipt.date)).toISOString().slice(0, 10) : todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // La cuenta del plan (CI) del cobro. Uno nuevo arranca en "CI - CERTIFICADOS".
  const accounts = useLedgerAccounts("ingreso");
  const [accountId, setAccountId] = useState(String(receipt?.accountId || ""));
  const chosenAccount = accountId || accounts.find(account => account.label === DEFAULT_ACCOUNTS.collection)?.value || "";
  const accountChanged = Boolean(receipt?.accountId) && chosenAccount !== String(receipt?.accountId || "");

  useEffect(() => {
    if (!clientId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ clientId, ...(receipt ? { receipt: receipt._id } : {}) });
    fetch(`/api/receipts?${query.toString()}`, { signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudieron traer las facturas"); return body.items as PendingInvoice[]; })
      .then(items => {
        setRows(items);
        // Al editar vuelve lo que el recibo ya había aplicado; desde una factura, se propone cobrarla entera.
        setApplied(Object.fromEntries(items.flatMap(item => item.appliedCents ? [[item._id, item.appliedCents / 100]] : item._id === initialInvoiceId ? [[item._id, item.balanceCents / 100]] : [])));
        setVersion(current => current + 1);
      })
      .catch(problem => { if (!controller.signal.aborted) { setRows([]); setError(problem instanceof Error ? problem.message : "No se pudieron traer las facturas"); } });
    return () => controller.abort();
  }, [clientId, receipt, initialInvoiceId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const allocations = useMemo(() => Object.entries(applied).map(([invoiceId, pesos]) => ({ invoiceId, amountCents: Math.round(pesos * 100) })).filter(allocation => allocation.amountCents > 0), [applied]);
  const totalCents = allocations.length ? allocations.reduce((total, allocation) => total + allocation.amountCents, 0) : Math.round(onAccount * 100);
  const over = rows?.find(row => Math.round((applied[row._id] || 0) * 100) > row.balanceCents);

  function setAll(pay: boolean) {
    setApplied(pay ? Object.fromEntries((rows || []).map(row => [row._id, row.balanceCents / 100])) : {});
    setVersion(current => current + 1);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receiptDate) return setError("Poné la fecha del recibo");
    if (over) return setError(`A la ${over.label} le quedan ${money(over.balanceCents)} por cobrar`);
    if (totalCents <= 0) return setError("Poné cuánto se cobra de cada factura, o el importe si es un pago a cuenta");
    if (!chosenAccount) return setError("Elegí la cuenta del plan a la que se imputa el cobro");
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    const response = await fetch(receipt ? `/api/receipts/${receipt._id}` : "/api/receipts", {
      method: receipt ? "PUT" : "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId, date: receiptDate, method, allocations, amountCents: allocations.length ? undefined : totalCents,
        account: String(form.get("account") || ""), reference: String(form.get("reference") || ""), notes: String(form.get("notes") || ""),
        accountId: chosenAccount, accountChangeReason: String(form.get("accountChangeReason") || ""),
      }),
    });
    const result = await response.json();
    if (!response.ok) { setBusy(false); return setError(result.error || "No se pudo guardar el recibo"); }
    try { await downloadReceiptPdf(result.pdf as ReceiptPdfData); } catch { /* el recibo ya quedó guardado: el PDF se baja desde la lista */ }
    onSaved();
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-modal-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><HandCoins /></span><div>
        <p className="eyebrow">{receipt ? `RECIBO ${String(receipt.number || "")}` : "NUEVO RECIBO"}</p>
        <h2 id="receipt-modal-title">{receipt ? "Editar recibo" : "Registrar un cobro"}</h2>
        <small>Elegí el cliente y cuánto se cobra de cada factura. Al guardar se descarga el recibo en PDF.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={event => { void save(event); }}>
        <div className="modal-form-body">
          <div className="form-grid">
            <label><span>Cliente *</span><SearchSelect name="clientId" options={clients} value={clientId} onChange={value => { setClientId(value); setRows(null); setApplied({}); }} required placeholder="Elegí el cliente…" /></label>
            <label><span>Fecha *</span><DateInput name="date" defaultValue={receiptDate} required recent onValueChange={setReceiptDate} /></label>
            <label><span>Medio de pago *</span><select value={method} onChange={event => setMethod(event.target.value)}>
              {Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label><span>Caja / banco</span><input name="account" defaultValue={String(receipt?.account || "")} placeholder="Banco, caja…" /></label>
            <label><span>Cuenta del plan *<em className="field-hint">Ingresos: solo cuentas CI</em></span><SearchSelect name="accountId" options={accounts} value={chosenAccount} onChange={setAccountId} required placeholder="Elegí la cuenta…" /></label>
            {accountChanged && <label className="wide"><span>Motivo del cambio de cuenta *<em className="field-hint">Queda en el historial de la imputación</em></span><input name="accountChangeReason" required /></label>}
            <label><span>Referencia</span><input name="reference" defaultValue={String(receipt?.reference || "")} placeholder="N° de transferencia, de cheque…" /></label>
          </div>

          {!clientId ? <div className="empty-state compact"><p>Elegí el cliente para ver sus facturas por cobrar.</p></div>
            : rows === null ? <div className="loading-state">Buscando sus facturas…</div>
              : !rows.length ? <div className="receipt-on-account">
                <p>Este cliente no tiene facturas por cobrar. Se puede registrar como pago a cuenta.</p>
                <label><span>Importe a cuenta *</span><MoneyInput key={`account-${version}`} name="onAccount" defaultValue={onAccount} onValueChange={setOnAccount} /></label>
              </div>
                : <>
                  <div className="receipt-table-head"><b>Facturas por cobrar</b><span>
                    <button type="button" className="link-btn" onClick={() => setAll(true)}>Cobrar todo</button>
                    <button type="button" className="link-btn" onClick={() => setAll(false)}>Limpiar</button>
                  </span></div>
                  <div className="table-scroll"><table className="receipt-table"><thead><tr><th>Factura</th><th>Fecha</th><th>Cotización / obra</th><th>Total</th><th>Saldo</th><th>Se cobra</th></tr></thead><tbody>
                    {rows.map(row => <tr key={row._id} className={Math.round((applied[row._id] || 0) * 100) > row.balanceCents ? "row-alert" : ""}>
                      <td data-label="Factura"><b>{row.label}</b><span className={`company-badge ${row.company}`}>{companyOf(row.company).short}</span></td>
                      <td data-label="Fecha">{row.issueDate ? date(row.issueDate) : "—"}</td>
                      <td data-label="Cotización / obra">{[row.quoteNumber, row.workLabel].filter(Boolean).join(" · ") || "—"}</td>
                      <td data-label="Total">{money(row.amountCents)}</td>
                      <td data-label="Saldo">{money(row.balanceCents)}</td>
                      <td data-label="Se cobra"><div className="receipt-apply">
                        <MoneyInput key={`${row._id}-${version}`} name={`apply-${row._id}`} defaultValue={applied[row._id] || 0} onValueChange={value => setApplied(current => ({ ...current, [row._id]: value }))} />
                        <button type="button" className="link-btn" onClick={() => { setApplied(current => ({ ...current, [row._id]: row.balanceCents / 100 })); setVersion(current => current + 1); }}>Todo</button>
                      </div></td>
                    </tr>)}
                  </tbody></table></div>
                </>}

          <label className="wide receipt-notes"><span>Observaciones</span><textarea name="notes" defaultValue={String(receipt?.notes || "")} placeholder="Salen en el PDF del recibo" /></label>
        </div>
        {error && <p className="form-error modal-error">{error}</p>}
        <footer><span>Total del recibo: <b>{money(totalCents)}</b></span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={busy || !clientId}>{busy ? "Guardando…" : receipt ? "Guardar y bajar el PDF" : "Guardar recibo y bajar el PDF"}</button></footer>
      </form>
    </section>
  </div>;
}
