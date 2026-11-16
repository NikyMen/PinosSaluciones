"use client";

import { useEffect, useState } from "react";
import type { Calendar } from "@/lib/work-calendar";
import { todayIso } from "@/lib/format";

export function WorkCalendarSettings() {
  const [year, setYear] = useState(Number(todayIso().slice(0, 4)));
  const [calendars, setCalendars] = useState<Calendar[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch("/api/work-calendar").then(async response => {
      if (!response.ok) throw new Error();
      setCalendars((await response.json()).items);
    }).catch(() => setError("No se pudo leer el calendario"));
  }, []);

  const current = drafts[year] ?? calendars?.find(item => item.year === year)?.holidays.map(row => `${row.date} ${row.name}`).join("\n") ?? "";

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(""); setError(""); setSaving(true);
    try {
      const holidays = current.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => ({ date: line.slice(0, 10), name: line.slice(10).trim() }));
      const response = await fetch("/api/work-calendar", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ year, holidays }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error || "No se pudo guardar el calendario"); return; }
      setCalendars(items => [...(items || []).filter(item => item.year !== year), result]);
      setMessage(`Feriados de ${year} guardados.`);
    } catch { setError("No se pudo guardar el calendario"); }
    finally { setSaving(false); }
  }

  return <section className="panel">
    <h2>Feriados de obras</h2>
    <form className="form-grid" onSubmit={save}>
      <label><span>Año</span><input type="number" min={2000} max={2100} value={year || ""} onChange={event => setYear(Number(event.target.value))} /></label>
      <label className="wide"><span>Feriados<em className="field-hint">Una fecha AAAA-MM-DD y su nombre por renglón</em></span>
        <textarea className="work-calendar-input" rows={12} value={current} onChange={event => setDrafts(items => ({ ...items, [year]: event.target.value }))} />
      </label>
      <button className="secondary-btn" disabled={saving || !calendars || year < 2000 || year > 2100}>Guardar feriados</button>
    </form>
    {error && <p className="notice error" role="alert">{error}</p>}
    {message && <p className="notice success" role="status">{message}</p>}
  </section>;
}
