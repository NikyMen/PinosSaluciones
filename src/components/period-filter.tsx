"use client";

import { COMPANIES, COMPANY_KEYS } from "@/lib/companies";
import { todayIso } from "@/lib/format";

export type PeriodValue = { from: string; to: string; company: string };

/** El mes en curso: del 1 al último día. */
export function currentMonth(): PeriodValue {
  const [year, month] = todayIso().split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${String(month).padStart(2, "0")}-01`, to: `${year}-${String(month).padStart(2, "0")}-${last}`, company: "" };
}

function shiftMonth(value: PeriodValue, delta: number): PeriodValue {
  const [year, month] = value.from.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1 + delta, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return { ...value, from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export const periodQuery = (value: PeriodValue) => new URLSearchParams(Object.entries(value).filter(([, item]) => item)).toString();

/** Desde, hasta y empresa, con atajos para mover un mes para atrás o para adelante. */
export function PeriodFilter({ value, onChange }: { value: PeriodValue; onChange: (value: PeriodValue) => void }) {
  return <div className="period-filter" role="group" aria-label="Período">
    <button type="button" className="secondary-btn" onClick={() => onChange(shiftMonth(value, -1))} aria-label="Mes anterior">‹</button>
    <label><span>Desde</span><input type="date" value={value.from} onChange={event => onChange({ ...value, from: event.target.value })} /></label>
    <label><span>Hasta</span><input type="date" value={value.to} onChange={event => onChange({ ...value, to: event.target.value })} /></label>
    <button type="button" className="secondary-btn" onClick={() => onChange(shiftMonth(value, 1))} aria-label="Mes siguiente">›</button>
    <label><span>Empresa</span><select value={value.company} onChange={event => onChange({ ...value, company: event.target.value })}>
      <option value="">Las dos</option>
      {COMPANY_KEYS.map(key => <option key={key} value={key}>{COMPANIES[key].short}</option>)}
    </select></label>
  </div>;
}

/** Baja un CSV que Excel abre con acentos y punto y coma. */
export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
  const cell = (value: string | number) => { const text = String(value); return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
  const blob = new Blob([`﻿${[header, ...rows].map(row => row.map(cell).join(";")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** Importe en pesos con coma decimal, para el CSV. */
export const csvAmount = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
