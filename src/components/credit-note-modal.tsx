"use client";

import { useCallback, useEffect, useState } from "react";
import { Scale, Undo2, X } from "lucide-react";
import { MoneyInput } from "@/components/fields";
import { date, dateTime, money } from "@/lib/format";
import { companyOf } from "@/lib/companies";
import type { ClientCredit } from "@/lib/credit-notes";
import type { PendingInvoice } from "@/lib/receipt-service";

/**
 * El saldo a favor de una nota de crédito: cuánto le queda sin aplicar, a qué
 * facturas se aplicó y, mientras tenga saldo, a qué factura pendiente del mismo
 * cliente y la misma empresa aplicarlo. No entra plata: es una compensación.
 */
export function CreditNoteModal({ noteId, canEdit, onClose, onChanged }: { noteId: string; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const [note, setNote] = useState<ClientCredit | null>(null);
  const [invoices, setInvoices] = useState<PendingInvoice[] | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState(0);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/invoices/${noteId}/credit`);
    const body = await response.json();
    if (!response.ok) { setError(body.error || "No se pudo leer la nota de crédito"); return; }
    setNote(body as ClientCredit);
    // Las facturas del cliente con saldo: las mismas que ofrece el recibo. Sin permiso de cobranzas, se ve el saldo y sus aplicaciones.
    const pending = await fetch(`/api/receipts?clientId=${(body as ClientCredit).clientId}`).then(result => result.ok ? result.json() : { items: [] }).catch(() => ({ items: [] }));
    setInvoices(((pending.items || []) as PendingInvoice[]).filter(invoice => invoice.company === (body as ClientCredit).company && invoice.balanceCents > 0));
  }, [noteId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const chosen = invoices?.find(invoice => invoice._id === invoiceId);
  const amountCents = Math.round(amount * 100);

  function choose(id: string) {
    setInvoiceId(id);
    const invoice = invoices?.find(candidate => candidate._id === id);
    // Se propone todo lo que se pueda: el saldo de la nota o lo que se debe de la factura, lo menor.
    setAmount(invoice && note ? Math.min(note.creditCents, invoice.balanceCents) / 100 : 0);
    setVersion(current => current + 1);
  }

  async function apply() {
    if (!note || !chosen) return setError("Elegí la factura");
    if (amountCents <= 0) return setError("Poné cuánto se aplica");
    if (amountCents > note.creditCents) return setError(`A la nota le quedan ${money(note.creditCents)} a favor`);
    if (amountCents > chosen.balanceCents) return setError(`A la ${chosen.label} le quedan ${money(chosen.balanceCents)} por cobrar`);
    setBusy(true); setError(""); setNotice("");
    const response = await fetch(`/api/invoices/${noteId}/credit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoiceId: chosen._id, amountCents }) });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return setError(body.error || "No se pudo aplicar");
    setNotice(`Se aplicaron ${money(amountCents)} a la ${chosen.label}.`);
    setInvoiceId(""); setAmount(0); setVersion(current => current + 1);
    onChanged();
    void load();
  }

  async function undo(applicationId: string, label: string) {
    setBusy(true); setError(""); setNotice("");
    const response = await fetch(`/api/invoices/${noteId}/credit?application=${applicationId}`, { method: "DELETE" });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return setError(body.error || "No se pudo deshacer");
    setNotice(`Se deshizo la aplicación a la ${label}: el saldo volvió a la nota.`);
    onChanged();
    void load();
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="credit-note-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Scale /></span><div>
        <p className="eyebrow">{note ? note.label.toUpperCase() : "NOTA DE CRÉDITO"}</p><h2 id="credit-note-title">Saldo a favor del cliente</h2>
        <small>{note ? `${note.clientName} · ${companyOf(note.company).short}. Se aplica a una factura pendiente del mismo cliente y la misma empresa: no entra plata, es una compensación.` : "Cargando…"}</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={event => event.preventDefault()}><div className="modal-form-body">
        {note && <dl className="payment-order-totals">
          <div><dt>Importe de la nota{note.issueDate ? ` (${date(note.issueDate)})` : ""}</dt><dd>{money(note.amountCents)}</dd></div>
          <div><dt>Ya aplicado</dt><dd>{money(note.amountCents - note.creditCents)}</dd></div>
          <div className="total"><dt>A favor, sin aplicar</dt><dd>{money(note.creditCents)}</dd></div>
        </dl>}

        {note && note.applications.length > 0 && <>
          <div className="receipt-table-head"><b>Aplicado a otras facturas</b></div>
          <div className="table-scroll"><table className="receipt-table"><thead><tr><th>Factura</th><th>Cuándo</th><th>Quién</th><th>Importe</th><th /></tr></thead><tbody>
            {note.applications.map(row => <tr key={row._id}>
              <td data-label="Factura"><b>{row.invoiceLabel}</b></td>
              <td data-label="Cuándo">{row.at ? dateTime(row.at) : "—"}</td>
              <td data-label="Quién">{row.userName || "—"}</td>
              <td data-label="Importe">{money(row.amountCents)}</td>
              <td>{canEdit && <button type="button" className="link-btn" disabled={busy} title="El saldo vuelve a la nota y la factura vuelve a deber ese importe" onClick={() => { void undo(row._id, row.invoiceLabel); }}><Undo2 size={14} /> Deshacer</button>}</td>
            </tr>)}
          </tbody></table></div>
        </>}

        {note && canEdit && note.creditCents > 0 && <>
          <div className="receipt-table-head"><b>Aplicar a una factura</b></div>
          {invoices === null ? <div className="loading-state">Buscando sus facturas…</div>
            : !invoices.length ? <div className="empty-state compact"><p>{note.clientName} no tiene facturas de {companyOf(note.company).short} por cobrar. El saldo queda a favor para la próxima.</p></div>
              : <div className="form-grid">
                <label><span>Factura *<em className="field-hint">Las que tienen algo por cobrar</em></span><select value={invoiceId} onChange={event => choose(event.target.value)}>
                  <option value="">Elegí la factura…</option>
                  {invoices.map(invoice => <option key={invoice._id} value={invoice._id}>{invoice.label} · debe {money(invoice.balanceCents)}</option>)}
                </select></label>
                <label><span>Importe a aplicar *<em className="field-hint">Todo o una parte</em></span><MoneyInput key={`credit-${version}`} name="creditAmount" defaultValue={amount} onValueChange={setAmount} /></label>
              </div>}
        </>}
        {notice && <div className="notice success" role="status">{notice}</div>}
      </div>
      {error && <p className="form-error modal-error">{error}</p>}
      <footer><span>Queda en el historial de la nota.</span><button type="button" className="secondary-btn" onClick={onClose}>Cerrar</button>
        {note && canEdit && note.creditCents > 0 && Boolean(invoices?.length) && <button type="button" className="primary-btn" disabled={busy || !invoiceId} onClick={() => { void apply(); }}>{busy ? "Aplicando…" : "Aplicar a la factura"}</button>}</footer></form>
    </section>
  </div>;
}
