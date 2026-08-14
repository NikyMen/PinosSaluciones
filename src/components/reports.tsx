"use client";

import { useEffect, useState } from "react";
import { Download, TrendingDown, TrendingUp } from "lucide-react";
import { money } from "@/lib/format";
import { AiChat } from "@/components/ai-chat";

export type Report = {
  cashflow: Array<{ period: string; incomeCents: number; outcomeCents: number }>;
  profitability: Array<{ id: string; name: string; budgetCents: number; revenueCents: number; costCents: number; marginCents: number }>;
};

export function Reports() {
  const now = new Date();
  const [from, setFrom] = useState(`${now.getFullYear()}-01-01`);
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/reports?from=${from}&to=${to}`)
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "No se pudo cargar el reporte.");
        return result as Report;
      })
      .then(result => {
        if (active) {
          setData(result);
          setError(null);
        }
      })
      .catch(requestError => {
        if (active) {
          setData(null);
          setError(requestError instanceof Error ? requestError.message : "No se pudo cargar el reporte.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [from, to]);

  const max = Math.max(1, ...(data?.cashflow.flatMap(row => [row.incomeCents, row.outcomeCents]) || []));

  async function pdf() {
    if (!data) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Pinos Soluciones — Reporte de gestión", 14, 18);
    doc.setFontSize(10);
    doc.text(`Período: ${from} a ${to}`, 14, 26);
    let y = 38;
    doc.setFontSize(13);
    doc.text("Flujo de caja", 14, y);
    y += 8;
    data.cashflow.forEach(row => {
      doc.setFontSize(10);
      doc.text(`${row.period}   Ingresos ${money(row.incomeCents)}   Egresos ${money(row.outcomeCents)}   Neto ${money(row.incomeCents - row.outcomeCents)}`, 14, y);
      y += 7;
    });
    y += 6;
    doc.setFontSize(13);
    doc.text("Rentabilidad por obra", 14, y);
    y += 8;
    data.profitability.forEach(row => {
      if (y > 280) {
        doc.addPage();
        y = 18;
      }
      doc.setFontSize(10);
      doc.text(`${row.name}: ingresos ${money(row.revenueCents)}, costos ${money(row.costCents)}, margen ${money(row.marginCents)}`, 14, y);
      y += 7;
    });
    doc.save(`reporte-pinos-${to}.pdf`);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ANÁLISIS</p>
          <h1>iA y Reportes</h1>
          <p>Reporte de gestión, flujo percibido y rentabilidad real por obra.</p>
        </div>
        <button className="primary-btn" onClick={pdf} disabled={!data}><Download size={18} /> Descargar PDF</button>
      </div>
      <div className="report-filters">
        <label>Desde<input type="date" value={from} onChange={event => { setLoading(true); setFrom(event.target.value); }} /></label>
        <label>Hasta<input type="date" value={to} onChange={event => { setLoading(true); setTo(event.target.value); }} /></label>
      </div>
      {loading ? <div className="loading-state">Calculando reportes…</div> : error ? <div className="panel error-panel"><p>{error}</p></div> : <>
        <section className="panel report-panel">
          <div className="panel-head"><div><h2>Flujo de caja</h2><p>Ingresos y egresos efectivamente realizados</p></div></div>
          <div className="cash-chart">
            {data?.cashflow.length ? data.cashflow.map(row => <div className="chart-row" key={row.period}><b>{row.period}</b><div className="bars"><span className="bar income" style={{ width: `${row.incomeCents / max * 100}%` }}><i>{money(row.incomeCents)}</i></span><span className="bar outcome" style={{ width: `${row.outcomeCents / max * 100}%` }}><i>{money(row.outcomeCents)}</i></span></div><strong className={row.incomeCents - row.outcomeCents >= 0 ? "positive" : "negative"}>{money(row.incomeCents - row.outcomeCents)}</strong></div>) : <div className="empty-state compact">Sin movimientos en el período.</div>}
          </div>
          <div className="chart-legend"><span><i className="income" /> Ingresos</span><span><i className="outcome" /> Egresos</span></div>
        </section>
        <section className="panel report-panel">
          <div className="panel-head"><div><h2>Rentabilidad por obra</h2><p>Ingresos devengados menos costos asignados</p></div></div>
          <div className="table-scroll"><table><thead><tr><th>Obra</th><th>Ingresos</th><th>Costos</th><th>Margen</th><th>Resultado</th></tr></thead><tbody>{data?.profitability.map(row => <tr key={row.id}><td><b>{row.name}</b></td><td>{money(row.revenueCents)}</td><td>{money(row.costCents)}</td><td><b className={row.marginCents >= 0 ? "positive" : "negative"}>{money(row.marginCents)}</b></td><td>{row.marginCents >= 0 ? <span className="result positive"><TrendingUp />Positivo</span> : <span className="result negative"><TrendingDown />Negativo</span>}</td></tr>)}</tbody></table></div>
          {!data?.profitability.length && <div className="empty-state compact">Asigná facturas y gastos a obras para ver su rentabilidad.</div>}
        </section>
      </>}
      <AiChat report={data} />
    </>
  );
}
