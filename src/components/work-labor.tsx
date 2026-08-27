"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Download, IdCard, Phone, Plus, Timer, Trash2, UserPlus, Users } from "lucide-react";
import { DateInput, SearchSelect, type Option } from "@/components/fields";
import { date, isoPlusDays, money, titleCase, todayIso } from "@/lib/format";

export type AssignedWorker = {
  workerId: string; name: string; dni?: string; phone?: string; category?: string;
  dailyRateCents?: number; hoursPerDay?: number; assignedByName?: string;
};

export type LaborEntry = {
  _id: string; workerId?: string; person: string; date: string; hours: number;
  hourlyRateCents?: number; costCents: number; note?: string; loadedByName?: string;
};

/** Una fila de la liquidación: lo que hay que pagarle a una persona en el período. */
type Settlement = { workerId: string; name: string; dni: string; days: number; hours: number; totalCents: number };

export function WorkLabor({ workId, assigned, labor, canEdit, onChanged }: {
  workId: string; assigned: AssignedWorker[]; labor: LaborEntry[]; canEdit: boolean; onChanged: (work: unknown) => void;
}) {
  const [catalog, setCatalog] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formKey, setFormKey] = useState(0);
  // Por defecto, la quincena que corre: es el caso que más se usa.
  const [from, setFrom] = useState(() => isoPlusDays(-15));
  const [to, setTo] = useState(() => todayIso());

  useEffect(() => {
    void fetch("/api/records/workers?limit=100")
      .then(response => response.ok ? response.json() : { items: [] })
      .then((result: { items?: Array<Record<string, unknown>> }) => setCatalog((result.items || []).map(row => ({
        value: String(row._id), label: String(row.name || `${row.lastName}, ${row.firstName}`),
        hint: `DNI ${row.dni} · ${titleCase(String(row.category || ""))}`,
      }))));
  }, []);

  const assignedIds = new Set(assigned.map(worker => String(worker.workerId)));
  const available = catalog.filter(option => !assignedIds.has(option.value));

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

  async function addHours(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form);
    const body = { workerId: String(data.get("workerId") || ""), date: String(data.get("date") || ""), hours: Number(data.get("hours") || 0), note: String(data.get("note") || "") };
    if (!body.workerId) return setError("Elegí a quién le cargás las horas");
    if (!body.date) return setError("Poné la fecha del parte diario");
    if (await call(`/api/works/${workId}/labor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })) {
      form.reset(); setFormKey(value => value + 1);
    }
  }

  async function removeEntry(entry: LaborEntry) {
    if (!confirm(`¿Borrar las ${entry.hours} h de ${entry.person} del ${date(entry.date)}?`)) return;
    await call(`/api/works/${workId}/labor?entryId=${entry._id}`, { method: "DELETE" });
  }

  // La liquidación se arma en el navegador: los partes diarios ya vienen con la obra.
  const { rows, filtered, totals } = useMemo(() => {
    const inRange = (labor || []).filter(entry => {
      const day = String(entry.date || "").slice(0, 10);
      return (!from || day >= from) && (!to || day <= to);
    });
    const grouped = new Map<string, Settlement & { dates: Set<string> }>();
    for (const entry of inRange) {
      const key = String(entry.workerId || entry.person);
      const worker = assigned.find(candidate => String(candidate.workerId) === key);
      const row = grouped.get(key) || { workerId: key, name: entry.person || worker?.name || "Sin nombre", dni: worker?.dni || "—", days: 0, hours: 0, totalCents: 0, dates: new Set<string>() };
      row.hours += Number(entry.hours || 0);
      row.totalCents += Number(entry.costCents || 0);
      row.dates.add(String(entry.date || "").slice(0, 10));
      grouped.set(key, row);
    }
    const settlements = [...grouped.values()].map(row => ({ ...row, days: row.dates.size })).sort((a, b) => b.totalCents - a.totalCents);
    return {
      rows: settlements,
      filtered: inRange.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))),
      totals: {
        hours: settlements.reduce((total, row) => total + row.hours, 0),
        cents: settlements.reduce((total, row) => total + row.totalCents, 0),
      },
    };
  }, [labor, assigned, from, to]);

  /** Descarga la liquidación del período tal como se ve, para pasarla a pagos. */
  function exportSettlement() {
    const header = ["Apellido y nombre", "DNI", "Jornadas", "Horas", "Importe"];
    const lines = [
      `Liquidación del ${date(from)} al ${date(to)}`,
      header.join(";"),
      ...rows.map(row => [row.name, row.dni, row.days, String(row.hours).replace(".", ","), (row.totalCents / 100).toFixed(2).replace(".", ",")].join(";")),
      ["TOTAL", "", "", String(totals.hours).replace(".", ","), (totals.cents / 100).toFixed(2).replace(".", ",")].join(";"),
    ];
    const blob = new Blob([`﻿sep=;\r\n${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `liquidacion-${from}-a-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <>
    {error && <div className="notice error">{error}</div>}

    <section className="panel work-detail-section">
      <div className="panel-head"><div className="section-title"><Users /><div><h2>Trabajadores de la obra</h2><p>Quiénes están asignados, con su DNI y su teléfono.</p></div></div><span className="activity-count">{assigned.length} asignados</span></div>
      {canEdit && <form className="inline-form worker-assign" key={`assign-${formKey}`} onSubmit={assign}>
        <SearchSelect name="workerId" options={available} placeholder={available.length ? "Buscar en el legajo…" : "Ya están todos asignados"} />
        <button className="primary-btn" disabled={busy || !available.length}><UserPlus size={16} /> Asignar a la obra</button>
      </form>}
      {!catalog.length && <p className="task-history-state">Todavía no hay nadie cargado en Trabajadores. Cargalos primero desde Obras → Trabajadores.</p>}
      <div className="worker-grid">
        {assigned.map(worker => <article className="worker-card" key={worker.workerId}>
          <div className="worker-card-head">
            <span className="worker-avatar">{initials(worker.name)}</span>
            <div><b>{worker.name}</b><small>{titleCase(worker.category || "")}</small></div>
            {canEdit && <button className="check-delete" onClick={() => { void unassign(worker); }} aria-label={`Sacar a ${worker.name}`}><Trash2 size={15} /></button>}
          </div>
          <p><IdCard size={13} /> DNI {worker.dni || "—"}</p>
          <p><Phone size={13} /> {worker.phone || "Sin teléfono"}</p>
          <p><Timer size={13} /> Jornal {money(worker.dailyRateCents || 0)} · {worker.hoursPerDay || 8} h</p>
        </article>)}
        {!assigned.length && catalog.length > 0 && <div className="empty-state compact"><p>Nadie asignado todavía.</p></div>}
      </div>
    </section>

    <section className="panel work-detail-section">
      <div className="panel-head"><div className="section-title"><Timer /><div><h2>Partes diarios</h2><p>Horas trabajadas por persona y por día.</p></div></div></div>
      {canEdit && <form className="mini-form" key={`labor-${formKey}`} onSubmit={addHours}>
        <SearchSelect name="workerId" options={assigned.map(worker => ({ value: String(worker.workerId), label: worker.name, hint: `Jornal ${money(worker.dailyRateCents || 0)}` }))} placeholder="Trabajador" />
        <DateInput name="date" defaultValue={todayIso()} required />
        <input name="hours" type="number" min="0" max="24" step="0.5" required placeholder="Horas" />
        <input name="note" placeholder="Tarea realizada (opcional)" />
        <button className="primary-btn" disabled={busy || !assigned.length}><Plus size={16} /> Cargar horas</button>
      </form>}
      {!assigned.length && <p className="task-history-state">Asigná trabajadores para poder cargarles horas.</p>}
    </section>

    <section className="panel work-detail-section">
      <div className="panel-head"><div className="section-title"><CalendarRange /><div><h2>Liquidación del período</h2><p>Filtrá las fechas y te dice cuántas horas hizo cada uno y cuánto cobra.</p></div></div>
        <button className="secondary-btn" onClick={exportSettlement} disabled={!rows.length}><Download size={16} /> Exportar</button>
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
          <td><b>{row.name}</b></td><td>{row.dni}</td><td>{row.days}</td><td>{row.hours} h</td><td><strong>{money(row.totalCents)}</strong></td>
        </tr>)}
        {rows.length > 0 && <tr className="settlement-total"><td colSpan={3}><b>Total del período</b></td><td><b>{totals.hours} h</b></td><td><b>{money(totals.cents)}</b></td></tr>}
      </tbody></table></div>
      {!rows.length && <div className="empty-state compact"><p>No hay horas cargadas entre el {date(from)} y el {date(to)}.</p></div>}

      {filtered.length > 0 && <div className="detail-list labor-detail">
        <p className="eyebrow">DETALLE DEL PERÍODO</p>
        {filtered.map(entry => <div className="detail-row" key={entry._id}>
          <b>{entry.person}</b>
          <span>{entry.hours} h · {date(entry.date)}{entry.note ? ` · ${entry.note}` : ""}</span>
          <strong>{money(entry.costCents)}</strong>
          {canEdit && <button className="check-delete" onClick={() => { void removeEntry(entry); }} aria-label={`Borrar parte de ${entry.person}`}><Trash2 size={14} /></button>}
        </div>)}
      </div>}
    </section>
  </>;
}

function initials(name: string) {
  return name.split(/[\s,]+/).filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();
}
