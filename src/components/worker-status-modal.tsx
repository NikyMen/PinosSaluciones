"use client";

import { useEffect, useState } from "react";
import { UserMinus, UserPlus, X } from "lucide-react";
import { DateInput } from "@/components/fields";
import { todayIso } from "@/lib/format";

type Worker = Record<string, unknown> & { _id: string };

/**
 * Dar de baja a un integrante (con fecha y motivo) o reactivarlo. Al volver
 * recibe un legajo nuevo; el anterior queda en su historial.
 */
export function WorkerStatusModal({ worker, onClose, onDone }: { worker: Worker; onClose: () => void; onDone: (message: string) => void }) {
  const leaving = worker.active !== false;
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = String(worker.name || `${worker.lastName}, ${worker.firstName}`);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date) return setError(leaving ? "Poné la fecha de la baja" : "Poné la fecha en que vuelve");
    setBusy(true); setError("");
    const response = await fetch(`/api/workers/${worker._id}/status`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(leaving ? { action: "baja", date, reason } : { action: "alta", date }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setError(result.error || "No se pudo guardar");
    onDone(leaving ? `${name} quedó dado de baja. Su legajo ${worker.fileNumber ?? ""} queda en el historial.` : `${name} volvió con el legajo ${result.fileNumber}.`);
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal worker-status-modal" role="dialog" aria-modal="true" aria-labelledby="worker-status-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon">{leaving ? <UserMinus /> : <UserPlus />}</span><div>
        <p className="eyebrow">{leaving ? `LEGAJO ${String(worker.fileNumber ?? "")}` : "REACTIVAR"}</p>
        <h2 id="worker-status-title">{leaving ? `Dar de baja a ${name}` : `Reactivar a ${name}`}</h2>
        <small>{leaving ? "Deja de aparecer para asignar a obras. Todo lo cargado y su legajo quedan en el historial." : "Vuelve con un número de legajo nuevo, distinto al del período anterior."}</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={event => { void submit(event); }}>
        <div className="modal-form-body"><div className="form-grid">
          <label><span>{leaving ? "Fecha de la baja *" : "Vuelve desde *"}</span><DateInput name="date" defaultValue={date} required recent onValueChange={setDate} /></label>
          {leaving && <label className="wide"><span>Motivo</span><textarea value={reason} maxLength={300} onChange={event => setReason(event.target.value)} placeholder="Renuncia, fin de obra, despido…" /></label>}
        </div></div>
        {error && <p className="form-error modal-error">{error}</p>}
        <footer><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className={leaving ? "danger-btn" : "primary-btn"} disabled={busy}>{busy ? "Guardando…" : leaving ? "Dar de baja" : "Reactivar con legajo nuevo"}</button></footer>
      </form>
    </section>
  </div>;
}
