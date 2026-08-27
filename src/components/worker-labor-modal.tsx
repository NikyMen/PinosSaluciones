"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, Pencil, Timer, Trash2, X } from "lucide-react";
import { DateInput } from "@/components/fields";
import { LaborEditor, type AssignedWorker, type LaborDraft, type LaborEntry } from "@/components/work-labor";
import { date, isoPlusDays, money, titleCase, todayIso } from "@/lib/format";

type Worker = { _id: string; label: string };
type WorkerWork = {
  _id: string; code: string; name: string; status: string;
  assigned: AssignedWorker; labor: LaborEntry[];
};

export function WorkerLaborModal({ worker, canEdit, onClose }: { worker: Worker; canEdit: boolean; onClose: () => void }) {
  const [works, setWorks] = useState<WorkerWork[]>([]);
  const [workId, setWorkId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [from, setFrom] = useState(() => isoPlusDays(-15));
  const [to, setTo] = useState(() => todayIso());

  const load = useCallback(async (preferredWorkId?: string) => {
    setLoading(true);
    const response = await fetch(`/api/workers/${worker._id}/labor`);
    const result = await response.json();
    if (!response.ok) setError(result.error || "No se pudieron cargar los horarios");
    else {
      const next = (result.works || []) as WorkerWork[];
      setWorks(next);
      setWorkId(current => {
        const preferred = preferredWorkId || current;
        if (next.some(work => work._id === preferred)) return preferred;
        return next.find(work => work.status === "en_curso")?._id || next[0]?._id || "";
      });
      setError("");
    }
    setLoading(false);
  }, [worker._id]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", keydown); };
  }, [onClose]);

  const work = works.find(candidate => candidate._id === workId);
  const entries = useMemo(() => (work?.labor || []).filter(entry => {
    const day = String(entry.date || "").slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  }).sort((a, b) => String(b.date).localeCompare(String(a.date))), [work, from, to]);
  const totals = useMemo(() => {
    const legacyDates = new Set(entries.filter(entry => entry.days === undefined).map(entry => String(entry.date || "").slice(0, 10)));
    return {
      days: round2(entries.reduce((sum, entry) => sum + Number(entry.days || 0), 0) + legacyDates.size),
      hours: round2(entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0)),
      cents: entries.reduce((sum, entry) => sum + Number(entry.costCents || 0), 0),
    };
  }, [entries]);

  async function call(url: string, init: RequestInit) {
    setBusy(true); setError("");
    const response = await fetch(url, init);
    const result = await response.json();
    if (!response.ok) setError(result.error || "No se pudo guardar");
    else { setEditing(""); setFormKey(value => value + 1); await load(workId); }
    setBusy(false);
  }

  function addHours(draft: LaborDraft) {
    if (!work) return;
    void call(`/api/works/${work._id}/labor`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft),
    });
  }

  function editEntry(entry: LaborEntry, draft: LaborDraft) {
    if (!work) return;
    void call(`/api/works/${work._id}/labor?entryId=${entry._id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(draft),
    });
  }

  function removeEntry(entry: LaborEntry) {
    if (!work || !confirm(`¿Borrar ${describeEntry(entry)} del ${date(entry.date)}?`)) return;
    void call(`/api/works/${work._id}/labor?entryId=${entry._id}`, { method: "DELETE" });
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal worker-labor-modal" role="dialog" aria-modal="true" aria-labelledby="worker-labor-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Timer /></span><div>
        <p className="eyebrow">HORARIOS Y LIQUIDACIÓN</p>
        <h2 id="worker-labor-title">{worker.label}</h2>
        <small>Carga de trabajo y total a pagar por período</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>

      <div className="modal-form-body worker-labor-body">
        {error && <div className="notice error">{error}</div>}
        {loading ? <div className="loading-state">Cargando…</div> : works.length ? <>
          <label className="worker-work-select"><span>Obra</span><select value={workId} onChange={event => { setWorkId(event.target.value); setEditing(""); }}>
            {works.map(option => <option value={option._id} key={option._id}>{option.code} · {option.name} ({titleCase(option.status)})</option>)}
          </select></label>

          {work && <>
            <div className="worker-labor-rate"><BriefcaseBusiness size={16} /><span>{work.code} · {work.name}</span><b>{work.assigned.rateMode === "hora" ? `${money(work.assigned.hourlyRateCents || 0)} por hora` : `${money(work.assigned.dailyRateCents || 0)} por jornada`}</b></div>
            {canEdit && <section className="worker-labor-section"><div><p className="eyebrow">CARGAR HORARIO</p><h3>Nuevo parte diario</h3></div>
              <LaborEditor key={`worker-labor-${formKey}-${work._id}`} assigned={[work.assigned]} busy={busy} submitLabel="Cargar trabajo" onSubmit={addHours} />
            </section>}

            <section className="worker-labor-section"><div><p className="eyebrow">LIQUIDACIÓN</p><h3>Total del período</h3></div>
              <div className="settlement-filters">
                <label>Desde<DateInput name="from" defaultValue={from} onValueChange={value => value && setFrom(value)} /></label>
                <label>Hasta<DateInput name="to" defaultValue={to} onValueChange={value => value && setTo(value)} /></label>
                <div className="settlement-shortcuts"><button type="button" onClick={() => { setFrom(isoPlusDays(-15)); setTo(todayIso()); }}>Última quincena</button><button type="button" onClick={() => { setFrom(isoPlusDays(-30)); setTo(todayIso()); }}>Último mes</button></div>
              </div>
              <div className="worker-labor-totals"><div><span>Jornadas</span><b>{qty(totals.days)}</b></div><div><span>Horas</span><b>{qty(totals.hours)} h</b></div><div className="amount"><span>A liquidar</span><b>{money(totals.cents)}</b></div></div>

              {entries.length ? <div className="detail-list labor-detail">{entries.map(entry => editing === entry._id
                ? <LaborEditor key={entry._id} assigned={[work.assigned]} busy={busy} submitLabel="Guardar cambios" entry={entry} onCancel={() => setEditing("")} onSubmit={draft => editEntry(entry, draft)} />
                : <div className="detail-row" key={entry._id}><b>{date(entry.date)}</b><span>{describeEntry(entry)}{entry.note ? ` · ${entry.note}` : ""}</span><strong>{money(entry.costCents)}</strong>{canEdit && <button className="check-delete" onClick={() => setEditing(entry._id)} aria-label={`Editar parte del ${date(entry.date)}`}><Pencil size={14} /></button>}{canEdit && <button className="check-delete" onClick={() => removeEntry(entry)} aria-label={`Borrar parte del ${date(entry.date)}`}><Trash2 size={14} /></button>}</div>)}</div>
                : <div className="empty-state compact"><p>No hay horas cargadas entre el {date(from)} y el {date(to)}.</p></div>}
            </section>
          </>}
        </> : <div className="empty-state"><BriefcaseBusiness /><p>Este trabajador todavía no está asignado a ninguna obra.</p><Link href="/app/works">Ir a Obras para asignarlo</Link></div>}
      </div>
      <footer><span>Los cambios quedan auditados.</span>{work && <Link className="secondary-btn" href={`/app/works/${work._id}#personal`}>Abrir obra</Link>}<button className="primary-btn" onClick={onClose}>Cerrar</button></footer>
    </section>
  </div>;
}

function round2(value: number) { return Math.round(value * 100) / 100; }
function qty(value: number) { return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(round2(value)); }
function describeEntry(entry: LaborEntry) {
  if (entry.mode !== "jornada") return `${qty(entry.hours)} h`;
  const days = Number(entry.days) || 0;
  return `${qty(days)} ${days === 1 ? "jornada" : "jornadas"} (${qty(entry.hours)} h)`;
}
