"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, TriangleAlert, X } from "lucide-react";
import { DateInput, SearchSelect } from "@/components/fields";
import { date } from "@/lib/format";
import { businessDaysBetween, workEndForDays } from "@/lib/business-days";

type Busy = { code: string; name: string; startDate: string; endDate: string };
type PlanningData = {
  quote: { _id: string; number: string; title: string; status: string } | null;
  work: { _id: string; code: string; name: string; status: string; startDate: string; endDate: string; durationBusinessDays: number; managerId: string; assigned: Array<{ workerId: string; name: string; hasLabor: boolean }> } | null;
  clientName: string; suggestedCode: string; suggestedName: string;
  workers: Array<{ _id: string; name: string; category: string; busy: Busy[] }>;
  users: Array<{ _id: string; name: string }>;
  holidays: string[];
};
export type PlanResult = { work: Record<string, unknown> & { _id: string; code: string; name: string }; created: boolean; kept: string[] };

/**
 * Planificar la obra en un solo paso: inicio previsto, duración en días hábiles
 * (el fin se calcula, de lunes a viernes y sin feriados), responsable y personal.
 * Desde una cotización aprobada que todavía no pasó a obra, la crea.
 */
export function PlanWorkModal({ quoteId, workId, onClose, onDone }: { quoteId?: string; workId?: string; onClose: () => void; onDone: (result: PlanResult) => void }) {
  const [data, setData] = useState<PlanningData | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState("");
  const [end, setEnd] = useState("");
  // El fin se remonta cuando lo calcula el sistema.
  const [endVersion, setEndVersion] = useState(0);
  const [managerId, setManagerId] = useState("");
  const [workerIds, setWorkerIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(workId ? { workId } : { quoteId: quoteId || "" });
    fetch(`/api/works/plan?${query.toString()}`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo abrir la planificación");
      const loaded = body as PlanningData;
      setData(loaded);
      setCode(loaded.suggestedCode); setName(loaded.suggestedName);
      setStart(loaded.work?.startDate || ""); setEnd(loaded.work?.endDate || "");
      setDuration(loaded.work?.durationBusinessDays ? String(loaded.work.durationBusinessDays) : "");
      setManagerId(loaded.work?.managerId || "");
      setWorkerIds(loaded.work?.assigned.map(row => row.workerId) || []);
      setEndVersion(current => current + 1);
    }).catch(problem => { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : "No se pudo abrir la planificación"); });
    return () => controller.abort();
  }, [quoteId, workId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const holidays = useMemo(() => new Set(data?.holidays || []), [data]);
  const days = Number(duration) || 0;

  /** Con el inicio y la duración, el fin sale solo. */
  function recalcEnd(nextStart: string, nextDays: number) {
    if (!nextStart || nextDays < 1) return;
    const computed = workEndForDays(nextStart, nextDays, holidays);
    if (computed) { setEnd(computed); setEndVersion(current => current + 1); }
  }
  function chooseStart(value: string) { setStart(value); recalcEnd(value, days); }
  function chooseDuration(value: string) { const clean = value.replace(/\D/g, "").slice(0, 4); setDuration(clean); recalcEnd(start, Number(clean) || 0); }
  /** Con el fin elegido a mano, la duración es la cantidad de días hábiles entre las dos fechas. */
  function chooseEnd(value: string) { setEnd(value); if (start && value && value >= start) setDuration(String(businessDaysBetween(start, value, holidays) || "")); }

  const locked = new Set((data?.work?.assigned || []).filter(row => row.hasLabor).map(row => row.workerId));
  const workerById = useMemo(() => new Map((data?.workers || []).map(worker => [worker._id, worker])), [data]);
  // Quien ya está en la obra pero dejó de estar activo en los legajos: se muestra con el nombre que quedó en la obra.
  const chosen = workerIds.map(id => workerById.get(id) || { _id: id, name: data?.work?.assigned.find(row => row.workerId === id)?.name || "Persona", category: "", busy: [] as Busy[] });
  const overlaps = (entries: Busy[]) => entries.filter(entry => !start || !end || !entry.startDate ? true : entry.startDate <= end && (entry.endDate || entry.startDate) >= start);

  async function save() {
    if (!data) return;
    if (!data.work && (!code.trim() || !name.trim())) return setError("Poné el código y el nombre de la obra");
    if (!start) return setError("Poné el inicio previsto");
    if (!end && days < 1) return setError("Poné la duración en días hábiles o el fin previsto");
    if (end && end < start) return setError("El fin previsto no puede ser anterior al inicio");
    setBusy(true); setError("");
    const response = await fetch("/api/works/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      ...(data.work ? { workId: data.work._id } : { quoteId: data.quote?._id, code, name }),
      // El fin que se ve es el que se guarda: la duración sólo sirve para calcularlo.
      startDate: start, endDate: end || undefined, durationBusinessDays: end ? undefined : days, managerId, workerIds, note,
    }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setError(result.error || "No se pudo guardar la planificación");
    onDone(result as PlanResult);
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="plan-work-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><CalendarDays /></span><div>
        <p className="eyebrow">PLANIFICAR OBRA</p>
        <h2 id="plan-work-title">{data ? data.work ? `${data.work.code} · ${data.work.name}` : `Cotización ${data.quote?.number || ""} — ${data.quote?.title || ""}` : "Cargando…"}</h2>
        <small>{data ? `${data.clientName ? `${data.clientName}. ` : ""}${data.work ? "Fechas, responsable y personal de la obra." : "Al guardar se crea la obra con estas fechas y esta gente."}` : ""}</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      {/* Se confirma con el botón, no con Enter (los buscadores usan Enter). */}
      <form onSubmit={event => event.preventDefault()}><div className="modal-form-body">
        {!data ? !error && <div className="loading-state">Cargando…</div> : <>
          <div className="form-grid">
            {!data.work && <>
              <label><span>Código de la obra *</span><input value={code} onChange={event => setCode(event.target.value)} maxLength={60} /></label>
              <label><span>Nombre de la obra *</span><input value={name} onChange={event => setName(event.target.value)} maxLength={200} /></label>
            </>}
            <label><span>Inicio previsto *</span><DateInput name="planStart" defaultValue={start} required quickRanges={[7, 14, 30]} onValueChange={chooseStart} /></label>
            <label><span>Duración<em className="field-hint">En días hábiles: de lunes a viernes, sin feriados</em></span><input inputMode="numeric" value={duration} onChange={event => chooseDuration(event.target.value)} placeholder="20" /></label>
            <label><span>Fin previsto *<em className="field-hint">Sale del inicio y la duración; también se puede elegir</em></span><DateInput key={`plan-end-${endVersion}`} name="planEnd" defaultValue={end} hideToday onValueChange={chooseEnd} /></label>
            <label><span>Responsable de la obra<em className="field-hint">Quien la sigue</em></span><SearchSelect name="managerId" value={managerId} onChange={setManagerId} options={data.users.map(user => ({ value: user._id, label: user.name }))} placeholder="Sin responsable" /></label>
          </div>

          <div className="receipt-table-head"><b>Personal ({chosen.length})</b></div>
          <div className="form-grid">
            <label className="wide"><span>Agregar a alguien de los legajos</span>
              <SearchSelect name="planWorker" value="" onChange={value => { if (value) setWorkerIds(current => current.includes(value) ? current : [...current, value]); }}
                options={data.workers.filter(worker => !workerIds.includes(worker._id)).map(worker => ({ value: worker._id, label: worker.name, hint: worker.category }))} placeholder="Buscar por nombre…" /></label>
          </div>
          {chosen.length > 0 ? <div className="table-scroll"><table className="receipt-table"><thead><tr><th>Persona</th><th>Categoría</th><th>Otras obras en esas fechas</th><th /></tr></thead><tbody>
            {chosen.map(worker => {
              const clash = overlaps(worker.busy);
              return <tr key={worker._id} className={clash.length ? "row-alert" : ""}>
                <td data-label="Persona"><b>{worker.name}</b></td>
                <td data-label="Categoría">{worker.category || "—"}</td>
                <td data-label="Otras obras">{clash.length ? <span><TriangleAlert size={14} /> {clash.map(entry => `${entry.code}${entry.startDate ? ` (${date(entry.startDate)}${entry.endDate ? ` → ${date(entry.endDate)}` : ""})` : " (sin fechas)"}`).join(" · ")}</span> : "—"}</td>
                <td>{locked.has(worker._id)
                  ? <small className="tracking-sub">Ya tiene horas cargadas</small>
                  : <button type="button" className="icon-btn" onClick={() => setWorkerIds(current => current.filter(id => id !== worker._id))} aria-label={`Sacar a ${worker.name}`}><X size={15} /></button>}</td>
              </tr>;
            })}
          </tbody></table></div> : <div className="empty-state compact"><p>Todavía no hay nadie asignado. Sin personal, la obra sigue figurando como sin planificar.</p></div>}
          <p className="invoice-note">Si alguien ya está en otra obra en esas fechas, avisa pero deja guardar. El jornal de cada uno se toma del legajo y se puede cambiar después en la obra.</p>

          <label className="wide receipt-notes"><span>Nota para Compras y Administración<em className="field-hint">Opcional: sale en el aviso con la fecha de inicio</em></span><input value={note} onChange={event => setNote(event.target.value)} maxLength={500} placeholder="Por ejemplo: los andamios tienen que estar el viernes" /></label>
        </>}
      </div>
      {error && <p className="form-error modal-error">{error}</p>}
      <footer><span>{start && end ? `Del ${date(start)} al ${date(end)}${days ? ` · ${days} ${days === 1 ? "día hábil" : "días hábiles"}` : ""}` : "Poné el inicio y la duración"}</span>
        <button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="primary-btn" disabled={busy || !data} onClick={() => { void save(); }}>{busy ? "Guardando…" : "Guardar planificación"}</button></footer></form>
    </section>
  </div>;
}
