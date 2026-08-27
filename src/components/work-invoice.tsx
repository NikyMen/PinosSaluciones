"use client";

import { useEffect, useMemo, useState } from "react";
import { FileCheck2, Percent, X } from "lucide-react";
import { MoneyInput } from "@/components/fields";
import { money } from "@/lib/format";

export type InvoiceableWork = {
  _id: string; code: string; name: string; budgetCents?: number; progress?: number;
  certificates?: Array<{ number?: string; percentage?: number; amountCents?: number }>;
};

/** Meses en castellano, para el período que se escribe en el certificado. */
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** El período que se propone en el certificado: el mes en curso. */
export function currentPeriod() {
  const now = new Date();
  return `${MONTHS[now.getMonth()][0].toUpperCase()}${MONTHS[now.getMonth()].slice(1)} ${now.getFullYear()}`;
}

/**
 * Facturar un avance de obra.
 *
 * Se pide el porcentaje que se quiere facturar y el importe sale solo del
 * presupuesto. Se guarda como certificado aprobado: eso es lo que avisa a
 * Administración por la campanita y le deja la tarea de emitir la factura.
 */
export function InvoiceWorkModal({ work, onClose, onDone }: { work: InvoiceableWork; onClose: () => void; onDone: (work: unknown) => void }) {
  const certificates = useMemo(() => work.certificates || [], [work.certificates]);
  const budgetCents = Number(work.budgetCents || 0);
  // Lo ya certificado marca cuánto queda: nadie quiere facturar dos veces lo mismo.
  const usedPercent = certificates.reduce((total, item) => total + Number(item.percentage || 0), 0);
  const remaining = Math.max(0, Math.round((100 - usedPercent) * 10) / 10);

  // Se propone lo que falta certificar del avance real; si no hay avance
  // todavía, el campo queda vacío: facturar el 100% no puede ser el default.
  const pendingPercent = Math.max(0, Math.round((Number(work.progress || 0) - usedPercent) * 10) / 10);
  const [percentage, setPercentage] = useState(() => pendingPercent > 0 ? String(Math.min(pendingPercent, remaining)) : "");
  const [override, setOverride] = useState<number | null>(null);
  const [period, setPeriod] = useState(currentPeriod);
  const [number, setNumber] = useState(`${work.code}-C${certificates.length + 1}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const percent = Number(percentage) || 0;
  const computedCents = Math.round(budgetCents * percent / 100);
  const amountCents = override ?? computedCents;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (percent <= 0) return setError("Poné qué porcentaje querés facturar");
    if (percent > remaining) return setError(`Ya hay certificado un ${usedPercent}%: como mucho podés facturar el ${remaining}% que queda`);
    setSaving(true); setError("");
    const response = await fetch(`/api/works/${work._id}/certificates`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ number, period, percentage: percent, amountCents, approved: true, file: "" }),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setError(result.error || "No se pudo generar el certificado");
    onDone(result);
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal invoice-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-modal-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><FileCheck2 /></span><div>
        <p className="eyebrow">FACTURAR AVANCE</p>
        <h2 id="invoice-modal-title">{work.name}</h2>
        <small>Obra {work.code} · Presupuesto {money(budgetCents)}</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>

      <form onSubmit={submit}>
        <div className="modal-form-body">
          <div className="invoice-summary">
            <div><span>Presupuesto</span><strong>{money(budgetCents)}</strong></div>
            <div><span>Ya certificado</span><strong>{usedPercent}% · {money(certificates.reduce((total, item) => total + Number(item.amountCents || 0), 0))}</strong></div>
            <div><span>Queda por facturar</span><strong>{remaining}%</strong></div>
            <div><span>Avance de obra</span><strong>{Number(work.progress || 0)}%</strong></div>
          </div>

          <div className="form-grid">
            <label><span>¿Qué porcentaje facturás? *</span>
              <div className="percent-input">
                <input type="number" min="0.1" max={remaining || 100} step="0.1" value={percentage} autoFocus
                  onChange={event => { setPercentage(event.target.value); setOverride(null); }} />
                <Percent size={15} />
              </div>
            </label>
            <label><span>Importe a facturar<em className="field-hint">Sale del presupuesto; se puede ajustar</em></span>
              <MoneyInput name="amountCents" key={`amount-${computedCents}`} defaultValue={amountCents / 100}
                onValueChange={value => setOverride(Math.round(value * 100))} />
            </label>
            <label><span>Número de certificado *</span><input value={number} required onChange={event => setNumber(event.target.value)} /></label>
            <label><span>Período *</span><input value={period} required onChange={event => setPeriod(event.target.value)} /></label>
          </div>

          <p className="invoice-note">
            {percent > 0
              ? <>Se certifica el <b>{percent}%</b> de {money(budgetCents)} = <b>{money(amountCents)}</b>{override !== null && override !== computedCents ? <> (calculado {money(computedCents)}, ajustado a mano)</> : null}. Administración recibe el aviso y le queda la tarea de emitir la factura.</>
              : <>Elegí el porcentaje que querés facturar y el importe se calcula solo.</>}
          </p>
        </div>
        {error && <p className="form-error modal-error">{error}</p>}
        <footer>
          <span>El certificado queda auditado con tu nombre.</span>
          <button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button>
          <button className="primary-btn" disabled={saving || percent <= 0}>{saving ? "Generando…" : "Facturar y avisar"}</button>
        </footer>
      </form>
    </section>
  </div>;
}
