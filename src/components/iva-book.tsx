"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { date, money } from "@/lib/format";
import { companyOf } from "@/lib/companies";
import type { IvaBook as Book, IvaRow } from "@/lib/accounting";
import { csvAmount, currentMonth, downloadCsv, PeriodFilter, periodQuery, type PeriodValue } from "@/components/period-filter";

/**
 * Libro IVA ventas y compras. Solo comprobantes fiscales: la Factura X nunca
 * entra, aunque cuente para todo lo demás (cuentas corrientes, caja, costos).
 */
export function IvaBook() {
  const [period, setPeriod] = useState<PeriodValue>(currentMonth);
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState("");
  const [side, setSide] = useState<"sales" | "purchases">("sales");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/accounting/iva?${periodQuery(period)}`, { signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudo armar el libro"); return body as Book; })
      .then(result => { setBook(result); setError(""); })
      .catch(problem => { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : "No se pudo armar el libro"); });
    return () => controller.abort();
  }, [period]);

  const rows: IvaRow[] = book ? book[side] : [];
  const totals = book?.totals[side];

  function exportCsv() {
    downloadCsv(`libro-iva-${side === "sales" ? "ventas" : "compras"}-${period.from}-${period.to}.csv`,
      ["Fecha", "Comprobante", "Número", side === "sales" ? "Cliente" : "Proveedor", "CUIT", "Empresa", "Neto", "IVA", "Total"],
      rows.map(row => [date(row.date), row.voucher, row.number, row.party, row.cuit, companyOf(row.company).legalName, csvAmount(row.netCents), csvAmount(row.vatCents), csvAmount(row.totalCents)]));
  }

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">CONTABILIDAD</p>
      <h1>Libro IVA</h1>
      <p>Ventas (Factura A y B) y compras (Factura A y C) del período. Los comprobantes X quedan afuera: no pasan por ARCA.</p>
    </div></div>
    <div className="toolbar">
      <PeriodFilter value={period} onChange={setPeriod} />
      <div className="tracking-filter" role="group" aria-label="Libro">
        <button type="button" className={side === "sales" ? "active" : ""} onClick={() => setSide("sales")}>Ventas</button>
        <button type="button" className={side === "purchases" ? "active" : ""} onClick={() => setSide("purchases")}>Compras</button>
      </div>
      <button type="button" className="secondary-btn" onClick={exportCsv} disabled={!rows.length}><Download size={17} /> Exportar a Excel</button>
    </div>
    {error && <div className="notice error">{error}</div>}
    {book && <div className="price-kpis tracking-kpis">
      <div className="stock-kpi"><span>Neto</span><strong>{money(totals?.netCents)}</strong><small>{rows.length} comprobantes</small></div>
      <div className="stock-kpi"><span>IVA {side === "sales" ? "débito" : "crédito"}</span><strong>{money(totals?.vatCents)}</strong><small>{side === "sales" ? "Ventas" : "Compras"}</small></div>
      <div className="stock-kpi"><span>Total</span><strong>{money(totals?.totalCents)}</strong><small>Fiscal</small></div>
      <div className="stock-kpi"><span>Comprobantes X</span><strong>{book.excludedX[side]}</strong><small>No van al libro</small></div>
    </div>}
    <section className="table-panel">
      {!book ? <div className="loading-state">Armando el libro…</div> : !rows.length ? <div className="empty-state"><p>No hay comprobantes fiscales en el período.</p></div>
        : <div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Comprobante</th><th>Número</th><th>{side === "sales" ? "Cliente" : "Proveedor"}</th><th>CUIT</th><th>Empresa</th><th>Neto</th><th>IVA</th><th>Total</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row._id}>
            <td data-label="Fecha">{date(row.date)}</td><td data-label="Comprobante">{row.voucher}</td><td data-label="Número">{row.number}</td>
            <td data-label={side === "sales" ? "Cliente" : "Proveedor"}>{row.party}</td><td data-label="CUIT">{row.cuit || "—"}</td>
            <td data-label="Empresa"><span className={`company-badge ${row.company}`}>{companyOf(row.company).short}</span></td>
            <td data-label="Neto">{money(row.netCents)}</td><td data-label="IVA">{money(row.vatCents)}</td><td data-label="Total"><b>{money(row.totalCents)}</b></td>
          </tr>)}</tbody></table></div>}
    </section>
  </>;
}
