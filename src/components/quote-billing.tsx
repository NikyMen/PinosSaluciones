"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, ReceiptText, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/fields";
import { date, money } from "@/lib/format";
import { billingStateLabels, type QuoteBilling } from "@/lib/quote-billing";

type Adjustment = { _id: string; kind: "adicional" | "reduccion"; netCents: number; reason: string; date?: string; userName?: string };
type BillingData = {
  billing: QuoteBilling;
  adjustments: Adjustment[];
  invoices: Array<{ _id: string; label: string; issueDate?: string; status: string; netCents: number; amountCents: number; workId: string | null; certificateNumber: string | null; remitos: number }>;
  certificates: Array<{ _id: string; workId: string; workCode?: string; number?: string; amountCents: number }>;
  remitos: Array<{ _id: string; number: string; status: string; pendingCents: number }>;
  works: Array<{ _id: string; code?: string; name?: string }>;
};

const pct = (value: number | null) => value === null ? "—" : `${String(value).replace(".", ",")} %`;

/**
 * Cuánto se facturó de la cotización y cuánto falta, en neto: lo cotizado
 * vigente (con adicionales y reducciones), lo facturado, el pendiente total y lo
 * que ya está habilitado para facturar. Requerimiento integral v4, punto 4.3.
 */
export function QuoteBillingPanel({ quoteId, canEdit, canRemove }: { quoteId: string; canEdit: boolean; canRemove: boolean }) {
  const [data, setData] = useState<BillingData | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState<Adjustment["kind"]>("adicional");
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/quotes/${quoteId}/billing`);
    const body = await response.json();
    if (!response.ok) return setError(body.error || "No se pudo leer la facturación");
    setData(body as BillingData);
  }, [quoteId]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function addAdjustment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (amount <= 0) return setError("Poné el importe neto");
    if (reason.trim().length < 3) return setError("Poné el motivo");
    setSaving(true); setError("");
    const response = await fetch(`/api/quotes/${quoteId}/adjustments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, netCents: Math.round(amount * 100), reason }) });
    const body = await response.json();
    setSaving(false);
    if (!response.ok) return setError(body.error || "No se pudo guardar");
    setAdding(false); setAmount(0); setReason("");
    await load();
  }

  async function removeAdjustment(item: Adjustment) {
    if (!confirm(`¿Sacar el ${item.kind === "adicional" ? "adicional" : "la reducción"} de ${money(item.netCents)}? Queda en el historial.`)) return;
    const response = await fetch(`/api/quotes/${quoteId}/adjustments?id=${item._id}`, { method: "DELETE" });
    if (!response.ok) return setError((await response.json()).error || "No se pudo sacar");
    await load();
  }

  if (!data) return error ? <div className="notice error">{error}</div> : null;
  const { billing } = data;

  return <section className="panel quote-billing">
    <div className="panel-head"><h2 className="section-title"><ReceiptText size={17} /> Facturación</h2>
      <small>En neto, sin IVA. El pendiente total no es lo habilitado para facturar ya: eso lo dan los certificados aprobados y los remitos sin facturar.</small></div>

    <div className="price-kpis tracking-kpis">
      <div className="stock-kpi"><span>Cotizado vigente</span><strong>{money(billing.currentCents)}</strong>
        <small>Original {money(billing.originalCents)}{billing.additionsCents ? ` + adicionales ${money(billing.additionsCents)}` : ""}{billing.reductionsCents ? ` − reducciones ${money(billing.reductionsCents)}` : ""}</small></div>
      <div className={billing.state === "exceso" ? "stock-kpi alert" : "stock-kpi"}><span>Facturado</span><strong>{money(billing.invoicedCents)}</strong>
        <small>{pct(billing.invoicedPct)} · <span className={`badge billing-${billing.state}`}>{billingStateLabels[billing.state]}</span>{billing.excessCents ? ` · ${money(billing.excessCents)} de más` : ""}</small></div>
      <div className="stock-kpi"><span>Pendiente total</span><strong>{money(billing.pendingCents)}</strong><small>Vigente menos facturado</small></div>
      <div className="stock-kpi"><span>Habilitado para facturar</span><strong>{money(billing.enabledCents)}</strong>
        <small>{data.certificates.length} certificado{data.certificates.length === 1 ? "" : "s"} y {data.remitos.length} remito{data.remitos.length === 1 ? "" : "s"} sin facturar</small></div>
    </div>
    {error && <p className="form-error">{error}</p>}

    <div className="quote-billing-grid">
      <div>
        <h3>Facturas que la aplican</h3>
        {!data.invoices.length ? <p className="muted">Todavía no tiene facturas.</p>
          : <table className="picked-lines"><thead><tr><th>Comprobante</th><th>Fecha</th><th>Origen</th><th>Neto</th></tr></thead><tbody>
            {data.invoices.map(invoice => <tr key={invoice._id}>
              <td data-label="Comprobante">{invoice.label}</td>
              <td data-label="Fecha">{invoice.issueDate ? date(invoice.issueDate) : "—"}</td>
              <td data-label="Origen">{invoice.certificateNumber ? `Certificado ${invoice.certificateNumber}` : invoice.remitos ? `${invoice.remitos} remito${invoice.remitos === 1 ? "" : "s"}` : "—"}
                {invoice.workId && <> · <Link href={`/app/works/${invoice.workId}`}>{data.works.find(work => work._id === invoice.workId)?.code || "obra"}</Link></>}</td>
              <td data-label="Neto">{money(invoice.netCents)}</td>
            </tr>)}
          </tbody></table>}
        {(data.certificates.length > 0 || data.remitos.length > 0) && <>
          <h3>Habilitado para facturar</h3>
          <ul className="quote-billing-sources">
            {data.certificates.map(certificate => <li key={certificate._id}><Link href={`/app/invoices?obra=${certificate.workId}&certificado=${certificate._id}`}>Certificado {certificate.number}</Link> ({certificate.workCode}) · {money(certificate.amountCents)}</li>)}
            {data.remitos.map(remito => <li key={remito._id}><Link href={`/app/invoices?remitos=${remito._id}`}>Remito {remito.number}</Link> · {money(remito.pendingCents)} pendientes</li>)}
          </ul>
        </>}
      </div>

      <div>
        <h3>Adicionales y reducciones</h3>
        {!data.adjustments.length ? <p className="muted">Sin adicionales ni reducciones: lo vigente es lo cotizado.</p>
          : <table className="picked-lines"><thead><tr><th>Tipo</th><th>Motivo</th><th>Neto</th><th /></tr></thead><tbody>
            {data.adjustments.map(item => <tr key={item._id}>
              <td data-label="Tipo"><span className={`badge ${item.kind === "adicional" ? "billing-total" : "billing-parcial"}`}>{item.kind === "adicional" ? "Adicional" : "Reducción"}</span></td>
              <td data-label="Motivo">{item.reason}<small className="tracking-sub">{item.date ? date(item.date) : ""}{item.userName ? ` · ${item.userName}` : ""}</small></td>
              <td data-label="Neto">{item.kind === "reduccion" ? "−" : "+"}{money(item.netCents)}</td>
              <td>{canRemove && <button type="button" className="icon-btn" title="Sacar" onClick={() => { void removeAdjustment(item); }}><Trash2 size={15} /></button>}</td>
            </tr>)}
          </tbody></table>}
        {canEdit && !adding && <button type="button" className="secondary-btn" onClick={() => setAdding(true)}><Plus size={15} /> Adicional o reducción</button>}
        {canEdit && adding && <form className="form-grid" onSubmit={addAdjustment}>
          <label><span>Tipo *</span><select value={kind} onChange={event => setKind(event.target.value as Adjustment["kind"])}><option value="adicional">Adicional</option><option value="reduccion">Reducción</option></select></label>
          <label><span>Importe neto *</span><MoneyInput name="netCents" required onValueChange={setAmount} /></label>
          <label className="wide"><span>Motivo *</span><input value={reason} onChange={event => setReason(event.target.value)} placeholder="Qué se agregó o se sacó, y quién lo acordó" /></label>
          <div className="wide"><button type="button" className="secondary-btn" onClick={() => setAdding(false)}>Cancelar</button> <button className="primary-btn" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button></div>
        </form>}
      </div>
    </div>
  </section>;
}
