"use client";

import { useEffect, useState } from "react";
import { Percent, X } from "lucide-react";
import { workStatusLabels } from "@/lib/entity-config";
import { displayedProgress, progressModeOf } from "@/lib/inspections";
import { fieldErrors } from "@/components/record-form";

type Work = Record<string, unknown> & { _id: string };

export function WorkStatusModal({ work, canEdit, onClose, onSaved }: { work: Work; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState(String(work.status || "planificada"));
  const [progress, setProgress] = useState(String(displayedProgress(work) ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fromInspections = progressModeOf(work) === "inspecciones";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, busy]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/records/works/${work._id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, ...(!fromInspections && progress !== "" ? { progress: Number(progress) } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) { setError(fieldErrors(result) || result.error || "No se pudo guardar"); return; }
      onSaved();
    } catch { setError("No se pudo guardar. Revisá la conexión e intentá de nuevo."); }
    finally { setBusy(false); }
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" disabled={busy} onClick={onClose} aria-label="Cerrar" />
    <section className="modal worker-status-modal" role="dialog" aria-modal="true" aria-labelledby="work-status-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Percent /></span><div>
        <h2 id="work-status-title">Estado de obra</h2><small>{String(work.code)} · {String(work.name)}</small>
      </div></div><button className="icon-btn" disabled={busy} onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={event => { void submit(event); }}>
        <div className="modal-form-body"><div className="form-grid">
          <label><span>Estado</span><select value={status} disabled={!canEdit || busy} onChange={event => setStatus(event.target.value)}>{Object.entries(workStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label><span>Avance de obra (%)</span><input type="number" min="0" max="100" step="0.01" value={progress} disabled={!canEdit || busy || fromInspections} onChange={event => setProgress(event.target.value)} placeholder="Sin avance cargado" /><small>{fromInspections ? "Calculado desde las inspecciones cerradas." : "Ingresá un porcentaje entre 0 y 100."}</small></label>
        </div><p>El porcentaje de avance pinta la misma proporción de la fila en rojo.</p></div>
        {error && <p className="form-error modal-error" role="alert">{error}</p>}
        <footer><button type="button" className="secondary-btn" disabled={busy} onClick={onClose}>Cerrar</button>{canEdit && <button className="primary-btn" disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</button>}</footer>
      </form>
    </section>
  </div>;
}
