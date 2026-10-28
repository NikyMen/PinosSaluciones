"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Download, FileDown, FileText, Printer, ScanBarcode } from "lucide-react";
import { SearchSelect, type Option } from "@/components/fields";
import { downloadCsv, csvAmount } from "@/components/period-filter";
import { date, dateTime, money, qty } from "@/lib/format";
import { downloadRemitoPdf, type RemitoData } from "@/lib/remito-pdf";
import { downloadSalidaPdf, type SalidaPdfData } from "@/lib/salida-pdf";
import { printTicket, readPrinterSettings } from "@/lib/ticket-print";
import { warehouseLabel } from "@/lib/warehouses";
import { fetchAllRecords } from "@/lib/fetch-all-records";

/*
 * El registro de las salidas a obra: cada comprobante de la Caja (CJ-…) con
 * los materiales que se llevaron, sus remitos y el costo que se cargó a la
 * obra. Se filtra por obra y por fechas, y de cada una se baja el PDF con los
 * costos, los remitos o se reimprime el ticket.
 */

type Delivery = SalidaPdfData & { _id: string; workId?: string };

function remitosOf(ticket: Delivery): RemitoData[] {
  return (ticket.remitos || []).map(remito => ({
    number: remito.number, date: ticket.date, kind: "egreso" as const,
    fromWarehouse: warehouseLabel(remito.warehouse), destination: ticket.destinationLabel || "Obra", quoteNumber: ticket.quoteNumber,
    items: ticket.lines.flatMap(line => (line.parts || []).filter(part => part.warehouse === remito.warehouse && part.quantity > 0)
      .map(part => ({ code: line.barcode || line.sku, name: line.name, unit: line.unit, quantity: part.quantity }))),
    note: ticket.note, userName: ticket.userName,
  }));
}

/** Los primeros materiales, para leer la salida de un vistazo. */
function summary(ticket: Delivery) {
  const shown = ticket.lines.slice(0, 3).map(line => `${qty(line.quantity)} ${line.unit} ${line.name}`);
  return ticket.lines.length > 3 ? `${shown.join(" · ")} y ${ticket.lines.length - 3} más` : shown.join(" · ");
}

export function WorkDeliveriesView({ initialWorkId = "" }: { initialWorkId?: string }) {
  const [works, setWorks] = useState<Option[]>([]);
  // La obra puede venir en la dirección (?obra=…), desde la pantalla de la obra.
  const [workId, setWorkId] = useState(initialWorkId);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAllRecords<{ _id: string; code?: string; name?: string }>("works")
      .then(items => setWorks(items.map(work => ({ value: work._id, label: `${work.code || ""} · ${work.name || ""}`.trim(), hint: work.code }))))
      .catch(() => setWorks([]));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ kind: "egreso", limit: "500", ...(workId && { workId }), ...(from && { from }), ...(to && { to }) });
    fetch(`/api/stock/caja?${query}`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudieron leer las salidas");
        setRows(body.items as Delivery[]); setError("");
      })
      .catch(problem => { if (!controller.signal.aborted) { setRows([]); setError(problem instanceof Error ? problem.message : "No se pudieron leer las salidas"); } });
    return () => controller.abort();
  }, [workId, from, to]);

  const totalCents = useMemo(() => (rows || []).reduce((total, row) => total + Number(row.totalCents || 0), 0), [rows]);
  const workLabel = works.find(work => work.value === workId)?.label;

  function exportCsv() {
    const lines = (rows || []).flatMap(row => row.lines.map(line => [
      row.number, date(row.date), row.destinationLabel || "", (row.remitos || []).map(remito => remito.number).join(" "),
      line.barcode || line.sku || "", line.name, line.unit, String(line.quantity).replace(".", ","), csvAmount(Number(line.unitCostCents || 0)), csvAmount(Number(line.totalCents || 0)), row.userName || "",
    ]));
    downloadCsv(`salidas-a-obra${workId ? `-${works.find(work => work.value === workId)?.hint || "obra"}` : ""}.csv`,
      ["Comprobante", "Fecha", "Obra", "Remitos", "Código", "Material", "Unidad", "Cantidad", "Costo unitario", "Subtotal", "Hizo"], lines);
  }

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">STOCK Y LOGÍSTICA</p>
      <h1>Salidas a obra</h1>
      <p>Todo el material que salió a obra por la Caja: qué se llevó, de qué depósito, con qué remito y cuánto se le cargó a la obra.</p>
    </div><Link className="primary-btn" href="/app/caja"><ScanBarcode size={18} /> Nueva salida</Link></div>
    <div className="toolbar deliveries-toolbar">
      <label className="deliveries-work"><span>Obra</span><SearchSelect name="workId" options={[{ value: "", label: "Todas las obras" }, ...works]} value={workId} onChange={setWorkId} placeholder="Todas las obras" /></label>
      <label><span>Desde</span><input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label><span>Hasta</span><input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
      <button type="button" className="secondary-btn" disabled={!rows?.length} onClick={exportCsv}><Download size={17} /> Exportar a Excel</button>
    </div>
    {error && <div className="notice error">{error}</div>}
    {rows !== null && rows.length > 0 && <div className="deliveries-total">
      <span>{rows.length} {rows.length === 1 ? "salida" : "salidas"}{workLabel ? ` a ${workLabel}` : ""}{rows.length === 500 ? " (las últimas 500: acotá las fechas para ver el resto)" : ""}</span>
      <b>Costo cargado a obra: {money(totalCents)}</b>
    </div>}
    <section className="table-panel">
      {rows === null ? <div className="loading-state">Cargando…</div> : !rows.length ? <div className="empty-state"><p>No hay salidas a obra{workId || from || to ? " con estos filtros" : " todavía"}.</p></div>
        : <div className="table-scroll"><table><thead><tr><th>Comprobante</th><th>Fecha</th><th>Obra</th><th>Materiales</th><th>Remitos</th><th>Costo</th><th>Hizo</th><th /></tr></thead><tbody>
          {rows.map(row => <tr key={row._id}>
            <td data-label="Comprobante"><b>{row.number}</b></td>
            <td data-label="Fecha">{date(row.date)}{row.createdAt && date(row.createdAt) !== date(row.date) && <small className="tracking-sub">Cargada el {dateTime(row.createdAt)}</small>}</td>
            <td data-label="Obra">{row.workId ? <Link href={`/app/works/${row.workId}`}>{row.destinationLabel || "Obra"}</Link> : row.destinationLabel || "—"}{row.quoteNumber && <small className="tracking-sub">Cotización {row.quoteNumber}</small>}</td>
            <td data-label="Materiales"><div className="cell-clamp">{summary(row)}</div>{row.note && <small className="tracking-sub">{row.note}</small>}</td>
            <td data-label="Remitos">{(row.remitos || []).map(remito => remito.number).join(", ") || "—"}</td>
            <td data-label="Costo"><b>{money(Number(row.totalCents || 0))}</b></td>
            <td data-label="Hizo">{row.userName || "—"}</td>
            <td className="row-actions">
              <button className="row-action-wide approve" title="PDF con todos los materiales, el costo de cada uno y el total" onClick={() => { void downloadSalidaPdf(row).catch(() => setError("No se pudo generar el PDF")); }}><FileDown size={15} /> PDF</button>
              {remitosOf(row).map(remito => <button key={remito.number} className="row-action-wide" title={`Remito ${remito.number} en PDF, sin precios`} onClick={() => { void downloadRemitoPdf(remito); }}><FileText size={15} /> {remito.number}</button>)}
              <button title="Imprimir el ticket" onClick={() => { void printTicket(row, readPrinterSettings().width).catch(() => setError("No se pudo abrir la impresión")); }}><Printer size={16} /></button>
            </td>
          </tr>)}
        </tbody></table></div>}
    </section>
  </>;
}
