"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText, Search, Tags } from "lucide-react";
import { DateInput } from "@/components/fields";
import { WorkTypesModal } from "@/components/work-types-modal";
import { PayrollImportModal } from "@/components/payroll-import-modal";
import { date, money, qty, todayIso } from "@/lib/format";
import { downloadPayrollPdf } from "@/lib/payroll-pdf";
import { quantityLabel } from "@/lib/work-type-labels";
import type { PayrollRow } from "@/lib/payroll";

type Result = { rows: PayrollRow[]; totals: { people: number; hours: number; cents: number; lines: number; works: number } };

const pad = (value: number) => String(value).padStart(2, "0");
/** La quincena de una fecha: del 1 al 15, o del 16 a fin de mes. */
function fortnight(iso: string, which?: 1 | 2) {
  const [year, month, dayOfMonth] = iso.split("-").map(Number);
  const half = which || (dayOfMonth <= 15 ? 1 : 2);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return half === 1 ? { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-15` } : { from: `${year}-${pad(month)}-16`, to: `${year}-${pad(month)}-${pad(last)}` };
}
function shiftMonth(iso: string, delta: number) {
  const [year, month] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`;
}
/** "Septiembre de 2026". */
const monthName = (iso: string) => new Date(`${iso.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("es-AR", { month: "long", year: "numeric" }).replace(/^./, letter => letter.toUpperCase());
const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cell = (value: string) => /[";\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
const number = (value: number) => String(Math.round(value * 100) / 100).replace(".", ",");

/** Liquidación de la quincena de toda la empresa: todas las obras, por legajo. */
export function PayrollView({ canEdit }: { canEdit: boolean }) {
  const [period, setPeriod] = useState(() => fortnight(todayIso()));
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string>("");
  const [rates, setRates] = useState(false);
  const [importing, setImporting] = useState(false);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    setResult(null);
    const response = await fetch(`/api/payroll?from=${period.from}&to=${period.to}`);
    const body = await response.json();
    if (!response.ok) { setError(body.error || "No se pudo armar la liquidación"); setResult({ rows: [], totals: { people: 0, hours: 0, cents: 0, lines: 0, works: 0 } }); return; }
    setError(""); setResult(body);
  }, [period]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load, version]);

  const rows = useMemo(() => {
    const tokens = normalize(search).split(/\s+/).filter(Boolean);
    return (result?.rows || []).filter(row => !tokens.length || tokens.every(token => normalize(`${row.fileNumber || ""} ${row.name} ${row.position} ${row.byType.map(type => type.workType).join(" ")} ${row.lines.map(line => `${line.workCode} ${line.workName}`).join(" ")}`).includes(token)));
  }, [result, search]);
  const totals = { hours: rows.reduce((total, row) => total + row.hours, 0), cents: rows.reduce((total, row) => total + row.totalCents, 0) };

  /** El Excel con las mismas columnas que la planilla de la quincena. */
  function exportExcel() {
    const header = ["Nº Legajo", "Apellido y Nombre", "Categoría", "Día", "T. Trabajo", "Horas", "Obra", "Total 15na $"];
    const lines = rows.flatMap(row => row.lines.map(line => [
      row.fileNumber ? String(row.fileNumber) : "", `${row.lastName} ${row.firstName}`.trim() || row.name, row.position, date(line.date), line.workType,
      number(line.quantity), line.workCode || line.workName, number(line.costCents / 100),
    ].map(value => cell(String(value))).join(";")));
    const total = ["", "Total", "", "", "", number(rows.reduce((sum, row) => sum + row.lines.reduce((inner, line) => inner + line.quantity, 0), 0)), "", number(totals.cents / 100)].join(";");
    const blob = new Blob([`﻿${[`Liquidación del ${date(period.from)} al ${date(period.to)}`, header.join(";"), ...lines, total].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `liquidacion-${period.from}-a-${period.to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const monthStart = `${period.from.slice(0, 7)}-01`;
  const first = fortnight(monthStart, 1); const second = fortnight(monthStart, 2);

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">OBRAS</p>
      <h1>Liquidación de quincena</h1>
      <p>Lo que se le paga a cada persona en la quincena, sumando todas las obras, con el detalle por día, obra y tipo de trabajo.</p>
    </div><div className="page-heading-actions">
      <button type="button" className="secondary-btn" onClick={() => setRates(true)}><Tags size={17} /> Tarifas</button>
      {canEdit && <button type="button" className="primary-btn" onClick={() => setImporting(true)}><FileSpreadsheet size={17} /> Importar planilla</button>}
    </div></div>

    <div className="payroll-period">
      <div className="payroll-month">
        <button type="button" className="secondary-btn" onClick={() => setPeriod(fortnight(shiftMonth(monthStart, -1), 2))} aria-label="Mes anterior">‹</button>
        <b>{monthName(monthStart)}</b>
        <button type="button" className="secondary-btn" onClick={() => setPeriod(fortnight(shiftMonth(monthStart, 1), 1))} aria-label="Mes siguiente">›</button>
      </div>
      <div className="tracking-filter" role="group" aria-label="Quincena">
        <button type="button" className={period.from === first.from && period.to === first.to ? "active" : ""} onClick={() => setPeriod(first)}>1ra quincena (1 al 15)</button>
        <button type="button" className={period.from === second.from && period.to === second.to ? "active" : ""} onClick={() => setPeriod(second)}>2da quincena (16 al {second.to.slice(8)})</button>
      </div>
      <label>Desde<DateInput key={`from-${period.from}`} name="from" defaultValue={period.from} onValueChange={value => value && value <= period.to && setPeriod(current => ({ ...current, from: value }))} /></label>
      <label>Hasta<DateInput key={`to-${period.to}`} name="to" defaultValue={period.to} onValueChange={value => value && value >= period.from && setPeriod(current => ({ ...current, to: value }))} /></label>
    </div>

    {notice && <div className="notice success" role="status">{notice}</div>}
    {error && <div className="notice error">{error}</div>}

    <div className="price-kpis">
      <div className="stock-kpi"><span>Personas</span><strong>{result ? rows.length : "…"}</strong><small>{result ? `${result.totals.works} obras con partes` : ""}</small></div>
      <div className="stock-kpi"><span>Horas</span><strong>{result ? qty(totals.hours) : "…"}</strong><small>Sin contar plus ni m²</small></div>
      <div className="stock-kpi"><span>Total a pagar</span><strong>{result ? money(totals.cents) : "…"}</strong><small>Del {date(period.from)} al {date(period.to)}</small></div>
    </div>

    <div className="toolbar">
      <div className="search"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Legajo, nombre, puesto, tipo de trabajo u obra…" aria-label="Buscar en la liquidación" /></div>
      <button type="button" className="secondary-btn" onClick={exportExcel} disabled={!rows.length}><Download size={17} /> Excel</button>
      <button type="button" className="primary-btn" disabled={!rows.length} onClick={() => { void downloadPayrollPdf({ from: period.from, to: period.to, rows, totals: { people: rows.length, ...totals } }).catch(() => setError("No se pudo generar el PDF")); }}><FileText size={17} /> PDF</button>
    </div>

    <section className="table-panel">
      {result === null ? <div className="loading-state">Armando la liquidación…</div>
        : !rows.length ? <div className="empty-state"><p>{result.rows.length ? "Nadie coincide con la búsqueda." : `No hay partes cargados entre el ${date(period.from)} y el ${date(period.to)}.`}</p>{canEdit && !result.rows.length && <button onClick={() => setImporting(true)}>Importar la planilla de la quincena</button>}</div>
          : <div className="table-scroll"><table className="payroll-table"><thead><tr><th>Legajo</th><th>Apellido y nombre</th><th>Puesto</th><th>Por tipo de trabajo</th><th>Horas</th><th>A pagar</th></tr></thead><tbody>
            {rows.map(row => <Fragment key={row.workerId}>
              <tr className="clickable-row" onClick={() => setOpen(current => current === row.workerId ? "" : row.workerId)} tabIndex={0} onKeyDown={event => { if (event.key === "Enter") setOpen(current => current === row.workerId ? "" : row.workerId); }}>
                <td data-label="Legajo"><b>{row.fileNumber ?? "—"}</b></td>
                <td data-label="Apellido y nombre"><span className="payroll-name"><ChevronDown size={14} className={open === row.workerId ? "open" : ""} /> {row.name}</span></td>
                <td data-label="Puesto">{row.position || "—"}</td>
                <td data-label="Por tipo de trabajo"><div className="tracking-list">{row.byType.map(type => <span key={type.workType} className="tracking-chip" title={money(type.costCents)}>{type.workType} · {quantityLabel(type.quantity, type.unit)}</span>)}</div></td>
                <td data-label="Horas">{qty(row.hours)}</td>
                <td data-label="A pagar"><b>{money(row.totalCents)}</b></td>
              </tr>
              {open === row.workerId && <tr className="payroll-detail"><td colSpan={6}><table><thead><tr><th>Día</th><th>Obra</th><th>Tipo de trabajo</th><th>Cantidad</th><th>Tarifa</th><th>Importe</th></tr></thead><tbody>
                {row.lines.map((line, index) => <tr key={index}><td>{date(line.date)}</td><td>{line.workCode || line.workName}</td><td>{line.workType}</td><td>{quantityLabel(line.quantity, line.unit)}</td><td>{money(line.rateCents)}</td><td>{money(line.costCents)}</td></tr>)}
              </tbody></table></td></tr>}
            </Fragment>)}
            <tr className="settlement-total"><td colSpan={4}><b>Total de la quincena</b></td><td><b>{qty(totals.hours)}</b></td><td><b>{money(totals.cents)}</b></td></tr>
          </tbody></table></div>}
    </section>

    {rates && <WorkTypesModal canEdit={canEdit} onClose={() => setRates(false)} onSaved={() => { setRates(false); setNotice("Tarifas guardadas. Valen para los partes que se carguen de ahora en adelante."); }} />}
    {importing && <PayrollImportModal onClose={() => setImporting(false)} onDone={(summary, from, to) => {
      setImporting(false);
      setNotice(`Planilla cargada: ${summary.entries} partes por ${money(summary.totalCents)}${summary.skipped ? `, ${summary.skipped} ya estaban` : ""}. ${summary.workersCreated ? `${summary.workersCreated} personas nuevas en el legajo. ` : ""}${summary.fileNumbersSet ? `${summary.fileNumbersSet} legajos completados. ` : ""}${summary.worksCreated ? `${summary.worksCreated} obras creadas (poneles su cliente). ` : ""}${summary.conflicts.length ? `Revisá: ${summary.conflicts.slice(0, 3).join("; ")}.` : ""}`);
      setPeriod({ from: from.slice(0, 10), to: to.slice(0, 10) }); setVersion(current => current + 1);
    }} />}
  </>;
}
