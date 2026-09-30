"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Search } from "lucide-react";
import { date, money } from "@/lib/format";
import type { TrackingRow, TrackingState } from "@/lib/tracking";
import { companyOf } from "@/lib/companies";

const stateLabels: Record<TrackingState, string> = { sin_facturar: "Sin facturar", facturado_parcial: "Falta facturar", por_cobrar: "Por cobrar", completa: "Cobrada" };
const filters: Array<{ value: "" | "por_cobrar" | "por_facturar" | "completa"; label: string }> = [
  { value: "", label: "Todas" }, { value: "por_cobrar", label: "Por cobrar" }, { value: "por_facturar", label: "Por facturar" }, { value: "completa", label: "Cobradas" },
];

function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Para el Excel: importe en pesos con coma decimal, y celdas con ; entre comillas. */
const amount = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const cell = (value: string) => /[";\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** Cotización → obra → facturas → recibos, en una sola línea, con lo que falta facturar y cobrar. */
export function TrackingView() {
  const [rows, setRows] = useState<TrackingRow[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]["value"]>("");

  useEffect(() => {
    fetch("/api/tracking")
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudo armar el seguimiento"); return body.items as TrackingRow[]; })
      .then(setRows)
      .catch(problem => { setRows([]); setError(problem instanceof Error ? problem.message : "No se pudo armar el seguimiento"); });
  }, []);

  const visible = useMemo(() => {
    const tokens = normalize(search).split(/\s+/).filter(Boolean);
    return (rows || []).filter(row => {
      if (filter === "por_cobrar" && row.balanceCents <= 0) return false;
      if (filter === "por_facturar" && row.toInvoiceCents <= 0) return false;
      if (filter === "completa" && row.state !== "completa") return false;
      if (!tokens.length) return true;
      const text = normalize([row.quote?.number, row.quote?.title, row.client?.name, ...row.works.flatMap(work => [work.code, work.name]), ...row.invoices.map(invoice => invoice.label), ...row.receipts.map(receipt => receipt.number)].filter(Boolean).join(" "));
      return tokens.every(token => text.includes(token));
    });
  }, [rows, search, filter]);

  const totals = visible.reduce((sum, row) => ({
    quoted: sum.quoted + row.quotedCents, invoiced: sum.invoiced + row.invoicedCents, collected: sum.collected + row.collectedCents,
    balance: sum.balance + row.balanceCents, toInvoice: sum.toInvoice + row.toInvoiceCents,
  }), { quoted: 0, invoiced: 0, collected: 0, balance: 0, toInvoice: 0 });

  function exportExcel() {
    const header = ["Cotización", "Título", "Cliente", "Obra", "Facturas", "Recibos", "Cotizado", "Facturado", "Cobrado", "Saldo por cobrar", "Falta facturar", "Estado"];
    const lines = visible.map(row => [
      row.quote?.number || "Sin cotización", row.quote?.title || "", row.client?.name || "", row.works.map(work => [work.code, work.name].filter(Boolean).join(" ")).join(" / "),
      row.invoices.map(invoice => invoice.label).join(" / "), row.receipts.map(receipt => receipt.number).join(" / "),
      amount(row.quotedCents), amount(row.invoicedCents), amount(row.collectedCents), amount(row.balanceCents), amount(row.toInvoiceCents), stateLabels[row.state],
    ].map(value => cell(String(value))).join(";"));
    const blob = new Blob([`﻿${[header.join(";"), ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `seguimiento-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">FINANZAS</p>
      <h1>Seguimiento</h1>
      <p>Cada cotización con su obra, las facturas que se le hicieron y los recibos que las cobraron, en una misma línea.</p>
    </div></div>

    <div className="price-kpis tracking-kpis">
      <div className="stock-kpi"><span>Cotizado</span><strong>{money(totals.quoted)}</strong><small>Cotizaciones aprobadas</small></div>
      <div className="stock-kpi"><span>Facturado</span><strong>{money(totals.invoiced)}</strong><small>Falta facturar {money(totals.toInvoice)}</small></div>
      <div className="stock-kpi"><span>Cobrado</span><strong>{money(totals.collected)}</strong><small>Con recibo</small></div>
      <div className={totals.balance ? "stock-kpi alert" : "stock-kpi"}><span>Por cobrar</span><strong>{money(totals.balance)}</strong><small>Facturado sin cobrar</small></div>
    </div>

    <div className="toolbar tracking-toolbar">
      <div className="search"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cotización, cliente, obra, factura o recibo…" aria-label="Buscar en el seguimiento" /></div>
      <div className="tracking-filter" role="group" aria-label="Filtrar por estado">
        {filters.map(option => <button key={option.value} type="button" className={filter === option.value ? "active" : ""} onClick={() => setFilter(option.value)}>{option.label}</button>)}
      </div>
      <button type="button" className="secondary-btn" onClick={exportExcel} disabled={!visible.length}><Download size={17} /> Exportar a Excel</button>
    </div>
    {error && <div className="notice error">{error}</div>}

    <section className="table-panel">
      {rows === null ? <div className="loading-state">Armando el seguimiento…</div>
        : !visible.length ? <div className="empty-state"><p>{rows.length ? "No hay cotizaciones que coincidan con la búsqueda." : "Todavía no hay cotizaciones aprobadas ni facturas cargadas."}</p></div>
          : <div className="table-scroll"><table className="tracking-table"><thead><tr>
            <th>Cotización</th><th>Cliente</th><th>Obra</th><th>Facturas</th><th>Recibos</th><th>Facturado</th><th>Cobrado</th><th>Saldo</th><th>Estado</th>
          </tr></thead><tbody>{visible.map(row => <tr key={row.key}>
            <td data-label="Cotización">{row.quote
              ? <Link href={`/app/quotes/${row.quote._id}`} className="tracking-quote"><b>{row.quote.number}</b><small>{row.quote.title}</small><small>{money(row.quote.amountCents)}</small></Link>
              : <span className="muted">Sin cotización</span>}</td>
            <td data-label="Cliente">{row.client?.name || "—"}</td>
            <td data-label="Obra">{row.works.length ? row.works.map(work => <Link key={work._id} href={`/app/works/${work._id}`} className="tracking-chip">{work.code || work.name}</Link>) : "—"}</td>
            <td data-label="Facturas">{row.invoices.length ? <div className="tracking-list">{row.invoices.map(invoice => <span key={invoice._id} className={`tracking-chip ${invoice.status}`} title={`${companyOf(invoice.company).legalName} · ${invoice.issueDate ? date(invoice.issueDate) : ""} · ${money(invoice.amountCents)} · cobrado ${money(invoice.collectedCents)}`}><i className={`company-dot ${invoice.company}`} />{companyOf(invoice.company).short} · {invoice.label}</span>)}</div> : <span className="muted">—</span>}</td>
            <td data-label="Recibos">{row.receipts.length ? <div className="tracking-list">{row.receipts.map(receipt => <span key={receipt._id} className="tracking-chip receipt" title={`${date(receipt.date)} · ${money(receipt.amountCents)}`}>{receipt.number}</span>)}</div> : <span className="muted">—</span>}</td>
            <td data-label="Facturado">{money(row.invoicedCents)}{row.toInvoiceCents > 0 && <small className="tracking-sub">Falta {money(row.toInvoiceCents)}</small>}</td>
            <td data-label="Cobrado">{money(row.collectedCents)}</td>
            <td data-label="Saldo"><b>{money(row.balanceCents)}</b></td>
            <td data-label="Estado"><span className={`badge tracking-${row.state}`}>{stateLabels[row.state]}</span></td>
          </tr>)}</tbody></table></div>}
    </section>
  </>;
}
