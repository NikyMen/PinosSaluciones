"use client";

import { useEffect, useState } from "react";
import { businessDaysBetween, workEndForDays, workStartForDays } from "@/lib/business-days";
import type { Calendar } from "@/lib/work-calendar";

export function WorkScheduleFields({ initialStart, initialEnd }: { initialStart: unknown; initialEnd: unknown }) {
  const [start, setStart] = useState(String(initialStart || "").slice(0, 10));
  const [end, setEnd] = useState(String(initialEnd || "").slice(0, 10));
  const [holidays, setHolidays] = useState<Set<string> | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/work-calendar").then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json() as { items: Calendar[] };
      setHolidays(new Set(data.items.flatMap(item => item.holidays.map(row => row.date))));
    }).catch(() => setError("No se pudo cargar el calendario de feriados"));
  }, []);

  const duration = start && end && holidays ? businessDaysBetween(start, end, holidays) : null;

  function setDuration(value: string) {
    setDraft(value);
    if (!holidays || !value) return;
    if (start) setEnd(workEndForDays(start, Number(value), holidays) || end);
    else if (end) setStart(workStartForDays(end, Number(value), holidays) || start);
  }

  return <div className="form-grid wide">
    <label><span>Inicio previsto</span><input type="date" name="startDate" value={start} onChange={event => {
      const next = event.target.value;
      setStart(next); setDraft(null);
      if (next && !end && draft && holidays) setEnd(workEndForDays(next, Number(draft), holidays));
    }} /></label>
    <label><span>Fin previsto</span><input type="date" name="endDate" min={start || undefined} value={end} onChange={event => {
      const next = event.target.value;
      setEnd(next); setDraft(null);
      if (next && !start && draft && holidays) setStart(workStartForDays(next, Number(draft), holidays));
    }} /></label>
    <label><span>Duración en días hábiles<em className="field-hint">De lunes a viernes, sin feriados nacionales.</em></span>
      <input type="number" min={1} max={3650} step={1} name="durationBusinessDays" value={draft ?? (duration || "")}
        disabled={!holidays || (!start && !end)} onChange={event => setDuration(event.target.value)} onBlur={() => { if (start && end) setDraft(null); }} />
    </label>
    {error && <small className="form-error">{error}</small>}
  </div>;
}
