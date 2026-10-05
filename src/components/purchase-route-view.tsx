"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Search, TriangleAlert } from "lucide-react";
import { date, money } from "@/lib/format";
import { companyOf } from "@/lib/companies";
import type { RouteRow, Unlinked } from "@/lib/purchase-route";
import { csvAmount, downloadCsv } from "@/components/period-filter";

const steps: Array<{ key: RouteRow["step"]; label: string }> = [
  { key: "solicitud", label: "Solicitud" }, { key: "orden", label: "Orden" }, { key: "recibida", label: "Recibida" },
  { key: "facturada", label: "Facturada" }, { key: "pagada", label: "Pagada" },
];
const filters = [
  { value: "", label: "Todas" }, { value: "abiertas", label: "Abiertas" }, { value: "alertas", label: "Con alertas" }, { value: "pagada", label: "Pagadas" },
] as const;

const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * La ruta de compras de punta a punta: de qué cotización u obra salió cada
 * orden, si llegó al Central, qué factura la cubre, qué orden de pago y qué
 * pago. Abajo, lo que quedó sin vínculo.
 */
export function PurchaseRouteView() {
  const [data, setData] = useState<{ rows: RouteRow[]; unlinked: Unlinked } | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]["value"]>("abiertas");

  useEffect(() => {
    fetch("/api/purchase-route")
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudo armar la ruta"); return body; })
      .then(setData)
      .catch(problem => { setData({ rows: [], unlinked: { purchaseInvoices: [], payments: [], salesInvoices: [], remitosToInvoice: 0 } }); setError(problem instanceof Error ? problem.message : "No se pudo armar la ruta"); });
  }, []);

  const visible = useMemo(() => {
    const tokens = normalize(search).split(/\s+/).filter(Boolean);
    return (data?.rows || []).filter(row => {
      if (filter === "abiertas" && (row.step === "pagada" || row.step === "cancelada")) return false;
      if (filter === "alertas" && !row.alerts.length) return false;
      if (filter === "pagada" && row.step !== "pagada") return false;
      const text = normalize([row.number, row.supplier, row.description, row.quote?.number, row.work?.code, ...row.invoices.map(invoice => invoice.label), ...row.payments.map(payment => payment.number)].filter(Boolean).join(" "));
      return tokens.every(token => text.includes(token));
    });
  }, [data, search, filter]);

  const totals = visible.reduce((sum, row) => ({ ordered: sum.ordered + row.orderedCents, invoiced: sum.invoiced + row.invoicedCents, paid: sum.paid + row.paidCents, orders: sum.orders + row.pendingOrdersCents }), { ordered: 0, invoiced: 0, paid: 0, orders: 0 });

  function exportCsv() {
    downloadCsv(`ruta-de-compras-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Orden", "Etapa", "Empresa", "Proveedor", "Cotización", "Obra", "Ordenado", "Recibida", "Facturas", "Facturado", "Pagos", "Pagado", "Alertas"],
      visible.map(row => [row.number, steps.find(step => step.key === row.step)?.label || row.step, companyOf(row.company).legalName, row.supplier, row.quote?.number || "", row.work?.code || "",
        csvAmount(row.orderedCents), row.receivedAt ? date(row.receivedAt) : "", row.invoices.map(invoice => invoice.label).join(" / "), csvAmount(row.invoicedCents),
        row.payments.map(payment => payment.number).join(" / "), csvAmount(row.paidCents), row.alerts.join(" / ")]));
  }

  const unlinked = data?.unlinked;
  const looseCount = unlinked ? unlinked.purchaseInvoices.length + unlinked.payments.length + unlinked.salesInvoices.length : 0;

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">COMPRAS</p>
      <h1>Ruta de compras</h1>
      <p>Cotización u obra → solicitud → orden de compra → recepción en el Central → factura → orden de pago → pago. Cada orden con su origen y cómo terminó.</p>
    </div></div>
    <div className="price-kpis tracking-kpis">
      <div className="stock-kpi"><span>Ordenado</span><strong>{money(totals.ordered)}</strong><small>{visible.length} órdenes</small></div>
      <div className="stock-kpi"><span>Facturado</span><strong>{money(totals.invoiced)}</strong><small>Facturas de compra</small></div>
      <div className="stock-kpi"><span>Pagado</span><strong>{money(totals.paid)}</strong><small>OP emitidas sin pagar {money(totals.orders)}</small></div>
      <div className={looseCount ? "stock-kpi alert" : "stock-kpi"}><span>Sin vínculo</span><strong>{looseCount}</strong><small>Documentos sueltos</small></div>
    </div>
    <div className="toolbar tracking-toolbar">
      <div className="search"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Orden, proveedor, cotización, obra, factura…" /></div>
      <div className="tracking-filter" role="group" aria-label="Filtrar">{filters.map(option => <button key={option.value} type="button" className={filter === option.value ? "active" : ""} onClick={() => setFilter(option.value)}>{option.label}</button>)}</div>
      <button type="button" className="secondary-btn" onClick={exportCsv} disabled={!visible.length}><Download size={17} /> Exportar a Excel</button>
    </div>
    {error && <div className="notice error">{error}</div>}
    <section className="table-panel">
      {!data ? <div className="loading-state">Armando la ruta…</div> : !visible.length ? <div className="empty-state"><p>No hay órdenes en esta vista.</p></div>
        : <div className="table-scroll"><table className="tracking-table"><thead><tr><th>Origen</th><th>Orden</th><th>Ruta</th><th>Recepción</th><th>Facturas</th><th>Pagos</th><th>Ordenado</th><th>Facturado</th><th>Pagado</th></tr></thead><tbody>
          {visible.map(row => <tr key={row._id} className={row.alerts.length ? "row-alert" : ""}>
            <td data-label="Origen">{row.quote ? <Link href={`/app/quotes/${row.quote._id}`} className="tracking-chip">{row.quote.number}</Link> : null}{row.work ? <Link href={`/app/works/${row.work._id}`} className="tracking-chip">{row.work.code}</Link> : null}{!row.quote && !row.work && <span className="muted">Stock / pedido</span>}</td>
            <td data-label="Orden"><b>{row.number}</b> <span className={`company-badge ${row.company}`}>{companyOf(row.company).short}</span><small className="tracking-sub">{row.supplier || "Sin proveedor"}{row.neededBy ? ` · requerida ${date(row.neededBy)}` : ""}</small></td>
            <td data-label="Ruta">{row.step === "cancelada" ? <span className="badge cancelada">Cancelada</span> : <div className="route-steps">{steps.map((step, index) => <i key={step.key} className={steps.findIndex(entry => entry.key === row.step) >= index ? "done" : ""} title={step.label}>{step.label}</i>)}</div>}
              {row.alerts.map(alert => <small key={alert} className="route-alert"><TriangleAlert size={12} /> {alert}</small>)}</td>
            <td data-label="Recepción">{row.receivedAt ? `${date(row.receivedAt)}` : "—"}</td>
            <td data-label="Facturas">{row.invoices.length ? <div className="tracking-list">{row.invoices.map(invoice => <span key={invoice._id} className={`tracking-chip ${invoice.status}`}>{invoice.label} · {money(invoice.amountCents)}</span>)}</div> : <span className="muted">—</span>}</td>
            <td data-label="Pagos">{row.payments.length ? <div className="tracking-list">{row.payments.map(payment => <span key={payment._id} className={`tracking-chip ${payment.status}`} title={date(payment.date)}>{payment.number} · {payment.status === "emitida" ? "emitida" : money(payment.amountCents)}</span>)}</div> : <span className="muted">—</span>}</td>
            <td data-label="Ordenado">{money(row.orderedCents)}</td>
            <td data-label="Facturado">{money(row.invoicedCents)}</td>
            <td data-label="Pagado"><b>{money(row.paidCents)}</b></td>
          </tr>)}
        </tbody></table></div>}
    </section>

    {unlinked && <section className="table-panel unlinked-panel">
      <header><h2>Documentos sin vínculo</h2><small>Lo que no está atado a su origen: conviene completarlo para que la ruta se pueda recorrer en los dos sentidos.</small></header>
      <div className="unlinked-grid">
        <div><h3>Facturas de compra sin orden de compra ({unlinked.purchaseInvoices.length})</h3><ul>{unlinked.purchaseInvoices.slice(0, 15).map(row => <li key={row._id}><Link href="/app/expenses">{row.label}</Link><span>{money(row.amountCents)}</span></li>)}</ul></div>
        <div><h3>Pagos sin factura de compra ({unlinked.payments.length})</h3><ul>{unlinked.payments.slice(0, 15).map(row => <li key={row._id}><Link href="/app/payments">{row.label}</Link><span>{money(row.amountCents)}</span></li>)}</ul></div>
        <div><h3>Facturas de venta sin cotización, obra ni remito ({unlinked.salesInvoices.length})</h3><ul>{unlinked.salesInvoices.slice(0, 15).map(row => <li key={row._id}><Link href="/app/invoices">{row.label}</Link><span>{money(row.amountCents)}</span></li>)}</ul></div>
        <div><h3>Remitos de venta sin facturar</h3><p><Link href="/app/remitos">{unlinked.remitosToInvoice} {unlinked.remitosToInvoice === 1 ? "remito" : "remitos"} para facturar</Link></p></div>
      </div>
    </section>}
  </>;
}
