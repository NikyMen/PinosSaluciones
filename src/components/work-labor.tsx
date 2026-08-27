"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Check, Download, FileText, IdCard, Pencil, Phone, Plus, Search, Timer, Trash2, UserPlus, Users, X } from "lucide-react";
import { DateInput, MoneyInput, SearchSelect, type Option } from "@/components/fields";
import { date, isoPlusDays, money, titleCase, todayIso } from "@/lib/format";
import { computeLabor, dailyRateCents, hourlyRateCents, hoursPerDay, rateMode, type RateMode } from "@/lib/labor";
import { buildLaborPdf } from "@/lib/labor-pdf";

export type AssignedWorker = {
  workerId: string; name: string; dni?: string; phone?: string; category?: string;
  rateMode?: string; dailyRateCents?: number; hoursPerDay?: number; hourlyRateCents?: number; assignedByName?: string;
};

export type LaborEntry = {
  _id: string; workerId?: string; person: string; date: string; mode?: string; hours: number; days?: number;
  dailyRateCents?: number; hourlyRateCents?: number; costCents: number; manualCost?: boolean;
  note?: string; loadedByName?: string;
};

/** Una fila de la liquidación: lo que hay que pagarle a una persona en el período. */
type Settlement = { workerId: string; name: string; dni: string; category: string; days: number; hours: number; totalCents: number };

export function WorkLabor({ work, assigned, labor, canEdit, onChanged }: {
  work: { _id: string; code: string; name: string }; assigned: AssignedWorker[]; labor: LaborEntry[]; canEdit: boolean; onChanged: (work: unknown) => void;
}) {
  const workId = work._id;
  const [catalog, setCatalog] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [editing, setEditing] = useState("");
  const [editingRates, setEditingRates] = useState("");
  // Filtro del personal: por nombre, DNI o categoría. Recorta las tarjetas y
  // también la liquidación, para poder liquidar de a grupos.
  const [personFilter, setPersonFilter] = useState("");
  // Por defecto, la quincena que corre: es el caso que más se usa.
  const [from, setFrom] = useState(() => isoPlusDays(-15));
  const [to, setTo] = useState(() => todayIso());

  useEffect(() => {
    void fetch("/api/records/workers?limit=100")
      .then(response => response.ok ? response.json() : { items: [] })
      .then((result: { items?: Array<Record<string, unknown>> }) => setCatalog((result.items || []).map(row => ({
        value: String(row._id), label: String(row.name || `${row.lastName}, ${row.firstName}`),
        hint: `DNI ${row.dni} · ${titleCase(String(row.category || ""))}`,
      })))).catch(() => setError("No se pudo cargar el legajo de trabajadores"));
  }, []);

  const assignedIds = new Set(assigned.map(worker => String(worker.workerId)));
  const available = catalog.filter(option => !assignedIds.has(option.value));
  const needle = personFilter.trim().toLowerCase();
  const matches = (worker: AssignedWorker) => !needle
    || `${worker.name} ${worker.dni || ""} ${titleCase(worker.category || "")}`.toLowerCase().includes(needle);
  const visibleWorkers = assigned.filter(matches);

  async function call(url: string, init: RequestInit) {
    setBusy(true); setError("");
    const response = await fetch(url, init);
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setError(result.error || "No se pudo guardar"); return false; }
    onChanged(result);
    return true;
  }

  async function assign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const workerId = String(new FormData(event.currentTarget).get("workerId") || "");
    if (!workerId) return setError("Elegí un trabajador del legajo");
    if (await call(`/api/works/${workId}/workers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workerId }) })) {
      setFormKey(value => value + 1);
    }
  }

  async function unassign(worker: AssignedWorker) {
    if (!confirm(`¿Sacar a ${worker.name} de esta obra?`)) return;
    await call(`/api/works/${workId}/workers?workerId=${worker.workerId}`, { method: "DELETE" });
  }

  async function addHours(draft: LaborDraft) {
    if (!draft.workerId) return setError("Elegí a quién le cargás las horas");
    if (!draft.date) return setError("Poné la fecha del parte diario");
    if (await call(`/api/works/${workId}/labor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) })) {
      setFormKey(value => value + 1);
    }
  }

  /** Corrige un parte ya cargado: cantidad, valor o importe final. */
  async function editEntry(entry: LaborEntry, draft: LaborDraft) {
    if (await call(`/api/works/${workId}/labor?entryId=${entry._id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) })) {
      setEditing("");
    }
  }

  /** Cambia lo que cobra una persona en esta obra, sin tocar el legajo. */
  async function saveRates(worker: AssignedWorker, rates: Record<string, number | string>) {
    if (await call(`/api/works/${workId}/workers?workerId=${worker.workerId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(rates) })) {
      setEditingRates("");
    }
  }

  async function removeEntry(entry: LaborEntry) {
    if (!confirm(`¿Borrar ${describeEntry(entry)} de ${entry.person} del ${date(entry.date)}?`)) return;
    await call(`/api/works/${workId}/labor?entryId=${entry._id}`, { method: "DELETE" });
  }

  // La liquidación se arma en el navegador: los partes diarios ya vienen con la obra.
  const { rows, filtered, totals } = useMemo(() => {
    const visibleIds = new Set(visibleWorkers.map(worker => String(worker.workerId)));
    const inRange = (labor || []).filter(entry => {
      const day = String(entry.date || "").slice(0, 10);
      if (needle && !visibleIds.has(String(entry.workerId || ""))) return false;
      return (!from || day >= from) && (!to || day <= to);
    });
    const grouped = new Map<string, Settlement & { dates: Set<string> }>();
    for (const entry of inRange) {
      const key = String(entry.workerId || entry.person);
      const worker = assigned.find(candidate => String(candidate.workerId) === key);
      const row = grouped.get(key) || {
        workerId: key, name: entry.person || worker?.name || "Sin nombre", dni: worker?.dni || "—",
        category: titleCase(worker?.category || ""), days: 0, hours: 0, totalCents: 0, dates: new Set<string>(),
      };
      row.hours += Number(entry.hours || 0);
      row.totalCents += Number(entry.costCents || 0);
      // Los partes nuevos traen la jornada calculada; los viejos solo la fecha.
      if (entry.days !== undefined) row.days += Number(entry.days) || 0;
      else row.dates.add(String(entry.date || "").slice(0, 10));
      grouped.set(key, row);
    }
    const settlements = [...grouped.values()].map(row => ({ ...row, days: round2(row.days + row.dates.size) })).sort((a, b) => b.totalCents - a.totalCents);
    return {
      rows: settlements,
      filtered: inRange.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))),
      totals: {
        days: round2(settlements.reduce((total, row) => total + row.days, 0)),
        hours: round2(settlements.reduce((total, row) => total + row.hours, 0)),
        cents: settlements.reduce((total, row) => total + row.totalCents, 0),
      },
    };
    // `needle` y `visibleWorkers` derivan de `assigned` y del filtro tipeado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labor, assigned, from, to, needle]);

  /** Descarga la liquidación del período tal como se ve, para pasarla a pagos. */
  function exportSettlement() {
    const header = ["Apellido y nombre", "DNI", "Jornadas", "Horas", "Importe"];
    const lines = [
      `Liquidación del ${date(from)} al ${date(to)}`,
      header.join(";"),
      ...rows.map(row => [row.name, row.dni, String(row.days).replace(".", ","), String(row.hours).replace(".", ","), (row.totalCents / 100).toFixed(2).replace(".", ",")].join(";")),
      ["TOTAL", "", String(totals.days).replace(".", ","), String(totals.hours).replace(".", ","), (totals.cents / 100).toFixed(2).replace(".", ",")].join(";"),
    ];
    const blob = new Blob([`﻿sep=;\r\n${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `liquidacion-${from}-a-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * La misma liquidación que se ve, en PDF con el logo: es lo que se firma y se
   * archiva. El logo se lee del sitio y se incrusta como imagen en el papel.
   */
  async function exportPdf() {
    setBusy(true);
    try {
      const [{ jsPDF }, logo, session] = await Promise.all([
        import("jspdf"),
        readLogo(),
        fetch("/api/auth/me").then(response => response.ok ? response.json() : null).catch(() => null),
      ]);
      const doc = new jsPDF();
      const filename = buildLaborPdf(doc, {
        work: { code: work.code, name: work.name }, from, to, totals,
        rows: rows.map(row => ({
          workerId: row.workerId, name: row.name, dni: row.dni, category: row.category,
          mode: "", days: row.days, hours: row.hours, rateCents: 0, totalCents: row.totalCents, manual: false,
        })),
        detail: filtered.map(entry => ({
          person: entry.person, date: entry.date, quantity: describeEntry(entry),
          rateCents: entry.mode === "jornada" ? Number(entry.dailyRateCents || 0) : Number(entry.hourlyRateCents || 0),
          costCents: entry.costCents, note: entry.note || "", manual: Boolean(entry.manualCost),
        })),
      }, { author: session?.name || "el sistema", logo });
      doc.save(filename);
    } catch { setError("No se pudo generar el PDF de la liquidación"); }
    finally { setBusy(false); }
  }

  return <>
    {error && <div className="notice error">{error}</div>}

    <section className="panel work-detail-section" id="personal">
      <div className="panel-head"><div className="section-title"><Users /><div><h2>Personal asignado</h2><p>Quiénes están en la obra, con su DNI, su teléfono y lo que cobran.</p></div></div><span className="activity-count">{needle ? `${visibleWorkers.length} de ${assigned.length}` : `${assigned.length} asignados`}</span></div>
      {assigned.length > 0 && <div className="worker-filter"><Search size={16} /><input value={personFilter} placeholder="Filtrar por nombre, DNI o categoría…" onChange={event => setPersonFilter(event.target.value)} />{personFilter && <button type="button" onClick={() => setPersonFilter("")} aria-label="Limpiar filtro"><X size={15} /></button>}</div>}
      {canEdit && <form className="inline-form worker-assign" key={`assign-${formKey}`} onSubmit={assign}>
        <SearchSelect name="workerId" options={available} placeholder={available.length ? "Buscar en el legajo…" : "Ya están todos asignados"} />
        <button className="primary-btn" disabled={busy || !available.length}><UserPlus size={16} /> Asignar a la obra</button>
      </form>}
      {!catalog.length && <p className="task-history-state">Todavía no hay nadie cargado en Trabajadores. Cargalos primero desde Obras → Trabajadores.</p>}
      <div className="worker-grid">
        {visibleWorkers.map(worker => <article className="worker-card" key={worker.workerId}>
          <div className="worker-card-head">
            <span className="worker-avatar">{initials(worker.name)}</span>
            <div><b>{worker.name}</b><small>{titleCase(worker.category || "")}</small></div>
            {canEdit && <button className="check-delete" onClick={() => { void unassign(worker); }} aria-label={`Sacar a ${worker.name}`}><Trash2 size={15} /></button>}
          </div>
          <p><IdCard size={13} /> DNI {worker.dni || "—"}</p>
          <p><Phone size={13} /> {worker.phone || "Sin teléfono"}</p>
          <p><Timer size={13} /> {rateMode(worker) === "jornada"
            ? <>Jornal {money(dailyRateCents(worker))} · {hoursPerDay(worker)} h · hora {money(hourlyRateCents(worker))}</>
            : <>Hora {money(hourlyRateCents(worker))} · jornada de {hoursPerDay(worker)} h · {money(dailyRateCents(worker))}</>}</p>
          {canEdit && (editingRates === String(worker.workerId)
            ? <WorkerRatesForm worker={worker} busy={busy} onCancel={() => setEditingRates("")} onSave={rates => { void saveRates(worker, rates); }} />
            : <button className="link-btn" onClick={() => setEditingRates(String(worker.workerId))}><Pencil size={13} /> Cambiar lo que cobra</button>)}
        </article>)}
        {!assigned.length && catalog.length > 0 && <div className="empty-state compact"><p>Nadie asignado todavía.</p></div>}
        {assigned.length > 0 && !visibleWorkers.length && <div className="empty-state compact"><p>Nadie coincide con “{personFilter}”.</p></div>}
      </div>
    </section>

    <section className="panel work-detail-section">
      <div className="panel-head"><div className="section-title"><Timer /><div><h2>Partes diarios</h2><p>Trabajo por persona y por día, por jornada o por hora. El importe se calcula solo y se puede pisar a mano.</p></div></div></div>
      {canEdit && <LaborEditor key={`labor-${formKey}`} assigned={assigned} busy={busy} submitLabel="Cargar trabajo"
        onSubmit={draft => { void addHours(draft); }} />}
      {!assigned.length && <p className="task-history-state">Asigná trabajadores para poder cargarles horas.</p>}
    </section>

    <section className="panel work-detail-section">
      <div className="panel-head"><div className="section-title"><CalendarRange /><div><h2>Liquidación del período</h2><p>Filtrá las fechas y te dice cuántas horas hizo cada uno y cuánto cobra.</p></div></div>
        <div className="settlement-actions">
          <button className="secondary-btn" onClick={exportSettlement} disabled={!rows.length}><Download size={16} /> Excel</button>
          <button className="primary-btn" onClick={() => { void exportPdf(); }} disabled={!rows.length || busy}><FileText size={16} /> Descargar PDF</button>
        </div>
      </div>

      <div className="settlement-filters">
        <label>Desde<DateInput name="from" defaultValue={from} onValueChange={value => value && setFrom(value)} /></label>
        <label>Hasta<DateInput name="to" defaultValue={to} onValueChange={value => value && setTo(value)} /></label>
        <div className="settlement-shortcuts">
          <button type="button" onClick={() => { setFrom(isoPlusDays(-15)); setTo(todayIso()); }}>Última quincena</button>
          <button type="button" onClick={() => { setFrom(isoPlusDays(-30)); setTo(todayIso()); }}>Último mes</button>
        </div>
      </div>

      <div className="table-scroll"><table><thead><tr><th>Trabajador</th><th>DNI</th><th>Jornadas</th><th>Horas</th><th>A pagar</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.workerId}>
          <td><b>{row.name}</b></td><td>{row.dni}</td><td>{qty(row.days)}</td><td>{qty(row.hours)} h</td><td><strong>{money(row.totalCents)}</strong></td>
        </tr>)}
        {rows.length > 0 && <tr className="settlement-total"><td colSpan={2}><b>Total del período</b></td><td><b>{qty(totals.days)}</b></td><td><b>{qty(totals.hours)} h</b></td><td><b>{money(totals.cents)}</b></td></tr>}
      </tbody></table></div>
      {!rows.length && <div className="empty-state compact"><p>No hay horas cargadas entre el {date(from)} y el {date(to)}.</p></div>}

      {filtered.length > 0 && <div className="detail-list labor-detail">
        <p className="eyebrow">DETALLE DEL PERÍODO</p>
        {filtered.map(entry => editing === entry._id
          ? <LaborEditor key={entry._id} assigned={assigned} busy={busy} submitLabel="Guardar cambios" entry={entry}
              onCancel={() => setEditing("")} onSubmit={draft => { void editEntry(entry, draft); }} />
          : <div className="detail-row" key={entry._id}>
            <b>{entry.person}</b>
            <span>{describeEntry(entry)} · {date(entry.date)}{entry.note ? ` · ${entry.note}` : ""}</span>
            <strong>{money(entry.costCents)}{entry.manualCost ? <em className="manual-flag" title="Importe puesto a mano">a mano</em> : null}</strong>
            {canEdit && <button className="check-delete" onClick={() => setEditing(entry._id)} aria-label={`Editar parte de ${entry.person}`}><Pencil size={14} /></button>}
            {canEdit && <button className="check-delete" onClick={() => { void removeEntry(entry); }} aria-label={`Borrar parte de ${entry.person}`}><Trash2 size={14} /></button>}
          </div>)}
      </div>}
    </section>
  </>;
}

function initials(name: string) {
  return name.split(/[\s,]+/).filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();
}

function round2(value: number) { return Math.round(value * 100) / 100; }

/** El logo del sitio, en base64, que es como lo quiere jsPDF. */
async function readLogo() {
  try {
    const blob = await (await fetch("/brand/pino-logo.png")).blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("logo"));
      reader.readAsDataURL(blob);
    });
  } catch { return undefined; }
}

/** Cantidades con coma decimal, como se escriben acá: 1,5 jornadas / 7,5 h. */
function qty(value: number) { return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(round2(value)); }

/** "1,5 jornadas (12 h)" o "6 h", segun como se cargo el parte. */
function describeEntry(entry: LaborEntry) {
  if (entry.mode !== "jornada") return `${qty(entry.hours)} h`;
  const days = Number(entry.days) || 0;
  return `${qty(days)} ${days === 1 ? "jornada" : "jornadas"} (${qty(entry.hours)} h)`;
}

/** Lo que se manda al guardar un parte, calculado o pisado a mano. */
export type LaborDraft = { workerId: string; date: string; mode: RateMode; quantity: number; rateCents: number; costCents: number; note: string };

/**
 * Carga y correccion de un parte diario.
 *
 * La cuenta se rehace sola mientras se tipea: cantidad x valor. Si alguien
 * escribe otro importe final, ese manda y queda marcado; volver a tocar la
 * cantidad o el valor lo devuelve al calculado.
 */
function LaborEditor({ assigned, entry, busy, submitLabel, onSubmit, onCancel }: {
  assigned: AssignedWorker[]; entry?: LaborEntry; busy: boolean; submitLabel: string;
  onSubmit: (draft: LaborDraft) => void; onCancel?: () => void;
}) {
  const [workerId, setWorkerId] = useState(() => String(entry?.workerId || ""));
  const [when, setWhen] = useState(() => String(entry?.date || todayIso()).slice(0, 10));
  const [mode, setMode] = useState<RateMode>(() => (entry?.mode === "jornada" ? "jornada" : entry ? "hora" : "jornada"));
  const [quantity, setQuantity] = useState(() => entry ? String(entry.mode === "jornada" ? entry.days ?? 0 : entry.hours) : "");
  const [rateCents, setRateCents] = useState(() => entry ? (entry.mode === "jornada" ? Number(entry.dailyRateCents) || 0 : Number(entry.hourlyRateCents) || 0) : 0);
  const [override, setOverride] = useState<number | null>(() => entry?.manualCost ? Number(entry.costCents) || 0 : null);
  const [note, setNote] = useState(() => String(entry?.note || ""));

  const worker = assigned.find(row => String(row.workerId) === workerId);
  const perDay = hoursPerDay(worker || {});
  const computed = computeLabor({ mode, quantity: Number(quantity) || 0, rateCents, hoursPerDay: perDay });
  const totalCents = override ?? computed.costCents;

  /** Al elegir a alguien (o cambiar el modo) se trae su valor y se recalcula. */
  function applyRatesOf(next: AssignedWorker | undefined, nextMode: RateMode) {
    setRateCents(next ? (nextMode === "jornada" ? dailyRateCents(next) : hourlyRateCents(next)) : 0);
    setOverride(null);
  }

  const options = assigned.map(row => ({
    value: String(row.workerId), label: row.name,
    hint: rateMode(row) === "jornada" ? `Jornal ${money(dailyRateCents(row))}` : `Hora ${money(hourlyRateCents(row))}`,
  }));

  return <form className="mini-form labor-editor" onSubmit={event => {
    event.preventDefault();
    onSubmit({ workerId, date: when, mode, quantity: Number(quantity) || 0, rateCents, costCents: totalCents, note });
  }}>
    {entry
      ? <span className="labor-editor-person">{entry.person}</span>
      : <SearchSelect name="workerId" options={options} placeholder="Trabajador" value={workerId}
          onChange={value => {
            const next = assigned.find(row => String(row.workerId) === value);
            const nextMode = rateMode(next || {});
            setWorkerId(value); setMode(nextMode); applyRatesOf(next, nextMode);
          }} />}

    <label className="labor-field"><small>Como se cobra</small>
      <select value={mode} onChange={event => { const next = event.target.value as RateMode; setMode(next); applyRatesOf(worker, next); }}>
        <option value="jornada">Por jornada</option>
        <option value="hora">Por hora</option>
      </select>
    </label>

    <DateInput name="date" defaultValue={when} required onValueChange={value => value && setWhen(value)} />

    <label className="labor-field"><small>{mode === "jornada" ? "Jornadas" : "Horas"}</small>
      <input type="number" min="0" max={mode === "jornada" ? 31 : 24} step="0.5" required placeholder={mode === "jornada" ? "1" : "8"}
        value={quantity} onChange={event => { setQuantity(event.target.value); setOverride(null); }} />
    </label>

    <label className="labor-field"><small>{mode === "jornada" ? "Valor del jornal" : "Valor hora"}</small>
      <MoneyInput name="rateCents" key={`rate-${workerId}-${mode}-${rateCents}`} defaultValue={rateCents / 100}
        onValueChange={value => { setRateCents(Math.round(value * 100)); setOverride(null); }} />
    </label>

    <label className="labor-field"><small>Total a cobrar</small>
      <MoneyInput name="costCents" key={`total-${computed.costCents}`} defaultValue={totalCents / 100}
        onValueChange={value => setOverride(Math.round(value * 100))} />
    </label>

    <input placeholder="Tarea realizada (opcional)" value={note} onChange={event => setNote(event.target.value)} />

    <p className="labor-hint">
      {mode === "jornada" ? `${qty(computed.hours)} h en total (jornada de ${qty(perDay)} h)` : `${qty(computed.days)} jornadas`}
      {override !== null && override !== computed.costCents ? ` · calculado ${money(computed.costCents)}, se paga el importe puesto a mano` : ""}
    </p>

    <button className="primary-btn" disabled={busy || !assigned.length || !workerId}>{entry ? <Check size={16} /> : <Plus size={16} />} {submitLabel}</button>
    {onCancel && <button type="button" className="secondary-btn" onClick={onCancel}><X size={16} /> Cancelar</button>}
  </form>;
}

/**
 * Valores de una persona en esta obra. El jornal y el valor hora van de la
 * mano: se cambia uno y el otro sale de las horas de la jornada.
 */
function WorkerRatesForm({ worker, busy, onSave, onCancel }: {
  worker: AssignedWorker; busy: boolean; onSave: (rates: Record<string, number | string>) => void; onCancel: () => void;
}) {
  const [mode, setMode] = useState<RateMode>(() => rateMode(worker));
  const [perDay, setPerDay] = useState(() => String(hoursPerDay(worker)));
  const [daily, setDaily] = useState(() => dailyRateCents(worker));
  const [hourly, setHourly] = useState(() => hourlyRateCents(worker));
  const hours = Number(perDay) > 0 ? Number(perDay) : 8;

  return <form className="worker-rates-form" onSubmit={event => {
    event.preventDefault();
    onSave({ rateMode: mode, hoursPerDay: hours, dailyRateCents: daily, hourlyRateCents: hourly });
  }}>
    <label><small>Como cobra</small>
      <select value={mode} onChange={event => setMode(event.target.value as RateMode)}>
        <option value="jornada">Por jornada</option>
        <option value="hora">Por hora</option>
      </select>
    </label>
    <label><small>Horas por jornada</small>
      <input type="number" min="1" max="24" step="0.5" value={perDay} onChange={event => {
        const next = Number(event.target.value) > 0 ? Number(event.target.value) : 8;
        setPerDay(event.target.value);
        if (mode === "jornada") setHourly(Math.round(daily / next)); else setDaily(Math.round(hourly * next));
      }} />
    </label>
    <label><small>Valor del jornal</small>
      <MoneyInput name="dailyRateCents" key={`daily-${daily}`} defaultValue={daily / 100}
        onValueChange={value => { const cents = Math.round(value * 100); setDaily(cents); setHourly(Math.round(cents / hours)); }} />
    </label>
    <label><small>Valor hora</small>
      <MoneyInput name="hourlyRateCents" key={`hourly-${hourly}`} defaultValue={hourly / 100}
        onValueChange={value => { const cents = Math.round(value * 100); setHourly(cents); setDaily(Math.round(cents * hours)); }} />
    </label>
    <div className="worker-rates-actions">
      <button className="primary-btn" disabled={busy}><Check size={15} /> Guardar</button>
      <button type="button" className="secondary-btn" onClick={onCancel}><X size={15} /> Cancelar</button>
    </div>
  </form>;
}
