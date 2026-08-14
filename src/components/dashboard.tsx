"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  ArrowRight, ArrowUpRight, BarChart3, BriefcaseBusiness, CalendarDays, CheckCircle2,
  CircleDollarSign, Clock3, FileSearch, HandCoins, HardHat, ListTodo, ReceiptText,
  RefreshCw, TrendingDown, TrendingUp, Users, WalletCards,
} from "lucide-react";
import { compactMoney, date, money, titleCase } from "@/lib/format";
import type { DashboardPeriod, DashboardRange } from "@/lib/dashboard";

type MonthlyPoint = { period: string; salesCents: number; invoicedCents: number; collectedCents: number; expenseCents: number };
type ActiveWork = { _id: string; name: string; code: string; progress: number; budgetCents: number; costCents: number; status: string; endDate?: string };
type DashboardData = {
  period: { range: DashboardPeriod; months: number; from: string; to: string; generatedAt: string };
  kpis: { activeWorks: number; averageProgress: number; salesCents: number; invoicedCents: number; receivableCents: number; netMarginCents: number; netMarginPercent: number | null };
  comparison: { salesPercent: number | null; invoicedPercent: number | null; netMarginPercent: number | null };
  monthlySeries: MonthlyPoint[];
  activeWorks: ActiveWork[];
  receivables: { totalCents: number; overdueCents: number; dueSoonCents: number; futureCents: number };
  cashflow: { incomeCents: number; expenseCents: number; balanceCents: number };
  alerts: { pendingTasks: number; checksDue: number; activeClients: number; openQuotes: number };
};

const ranges: Array<{ value: DashboardRange; label: string }> = [
  { value: "1m", label: "Último mes" },
  { value: "3m", label: "Últimos 3 meses" },
  { value: "6m", label: "Últimos 6 meses" },
];

type DashboardFilter =
  | { kind: "preset"; range: DashboardRange }
  | { kind: "custom"; from: string; to: string };

export function Dashboard() {
  const [filter, setFilter] = useState<DashboardFilter>({ kind: "preset", range: "3m" });
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(filter.kind === "custom"
      ? { from: filter.from, to: filter.to }
      : { range: filter.range });
    void fetch(`/api/dashboard?${params.toString()}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "No se pudo cargar el tablero");
        return result as DashboardData;
      })
      .then(result => { setData(result); setError(""); })
      .catch(loadError => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el tablero");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filter, reloadKey]);

  function changeRange(value: DashboardRange) {
    if (filter.kind === "preset" && value === filter.range) return;
    setLoading(true);
    setError("");
    setFilter({ kind: "preset", range: value });
  }

  function applyCustomFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customFrom || !customTo) {
      setError("Seleccioná las fechas desde y hasta.");
      return;
    }
    if (customFrom > customTo) {
      setError("La fecha desde no puede ser posterior a la fecha hasta.");
      return;
    }
    setLoading(true);
    setError("");
    setFilter({ kind: "custom", from: customFrom, to: customTo });
  }

  function retry() {
    setLoading(true);
    setError("");
    setReloadKey(value => value + 1);
  }

  return (
    <div className="dashboard-page">
      <section className="dashboard-filter-bar" aria-label="Filtros de período">
        <div className="range-control" role="group" aria-label="Período del tablero">
          {ranges.map(item => <button key={item.value} type="button" className={filter.kind === "preset" && filter.range === item.value ? "active" : ""} aria-pressed={filter.kind === "preset" && filter.range === item.value} onClick={() => changeRange(item.value)}>{item.label}</button>)}
        </div>
        <form className={`date-filter${filter.kind === "custom" ? " active" : ""}`} onSubmit={applyCustomFilter}>
          <label>Desde<input type="date" value={customFrom} onChange={event => setCustomFrom(event.target.value)} /></label>
          <span aria-hidden="true">a</span>
          <label>Hasta<input type="date" value={customTo} onChange={event => setCustomTo(event.target.value)} /></label>
          <button className="primary-btn" type="submit" disabled={!customFrom || !customTo}>Aplicar</button>
        </form>
        <span className="updated-chip"><RefreshCw className={loading ? "spinning" : ""} size={14} /> {loading ? "Actualizando" : "Actualizado ahora"}</span>
      </section>

      {error && <div className="notice error dashboard-error"><span>{error}</span><button onClick={retry}>Reintentar</button></div>}

      <section className="executive-kpi-grid" aria-label="Indicadores principales">
        {data ? <>
          <KpiCard href="/app/quotes" label="Ventas cerradas" value={data.kpis.salesCents} format={compactMoney} detail={money(data.kpis.salesCents)} help="Cotizaciones aprobadas · Ver detalle" comparison={data.comparison.salesPercent} icon={HandCoins} tone="navy" />
          <KpiCard href="/app/invoices" label="Facturación" value={data.kpis.invoicedCents} format={compactMoney} detail={money(data.kpis.invoicedCents)} help={`${periodLabel(data.period)} · Ver detalle`} comparison={data.comparison.invoicedPercent} icon={ReceiptText} tone="red" />
          <KpiCard href="/app/collections" label="Cuentas por cobrar" value={data.kpis.receivableCents} format={compactMoney} detail={money(data.kpis.receivableCents)} help={`${percentage(data.receivables.overdueCents, data.receivables.totalCents)}% vencido · Gestionar`} icon={CircleDollarSign} tone="blue" />
          <KpiCard href="/app/reports" label="Margen neto" value={data.kpis.netMarginCents} format={compactMoney} detail={money(data.kpis.netMarginCents)} help={data.kpis.netMarginPercent === null ? "Sin facturación · Ver reportes" : `${data.kpis.netMarginPercent}% sobre facturación · Ver reportes`} comparison={data.comparison.netMarginPercent} icon={TrendingUp} tone="green" />
          <KpiCard href="/app/works" label="Obras en ejecución" value={data.kpis.activeWorks} format={value => String(Math.round(value))} help={`${data.kpis.averageProgress}% de avance promedio · Ver obras`} icon={HardHat} tone="slate" />
        </> : Array.from({ length: 5 }, (_, index) => <div className="kpi-card skeleton" key={index} />)}
      </section>

      <div className="executive-grid">
        <section className="panel trend-panel">
          <div className="panel-head">
            <div><p className="eyebrow">EVOLUCIÓN</p><h2>Rendimiento comercial y financiero</h2><p>Comparativa mensual en pesos argentinos</p></div>
            <Link href="/app/reports">Ver reportes <ArrowUpRight size={16} /></Link>
          </div>
          {data ? <MonthlyChart points={data.monthlySeries} /> : <div className="chart-skeleton skeleton" />}
        </section>

        <section className="panel receivable-panel">
          <div className="panel-head"><div><p className="eyebrow">COBRANZAS</p><h2>Cuentas por cobrar</h2><p>Exposición actual por vencimiento</p></div></div>
          {data ? <ReceivableDonut data={data.receivables} /> : <div className="donut-skeleton skeleton" />}
        </section>
      </div>

      <section className="panel works-overview">
        <div className="panel-head">
          <div><p className="eyebrow">OPERACIONES</p><h2>Obras en ejecución</h2><p>Avance físico y consumo de presupuesto</p></div>
          <Link href="/app/works">Gestionar obras <ArrowUpRight size={16} /></Link>
        </div>
        <div className="work-card-grid">
          {data ? data.activeWorks.length ? data.activeWorks.map(work => <WorkCard key={work._id} work={work} />) : <div className="empty-state dashboard-empty"><HardHat /><p>No hay obras en ejecución.</p><Link href="/app/works">Ir a obras</Link></div> : Array.from({ length: 4 }, (_, index) => <div className="work-progress-card skeleton" key={index} />)}
        </div>
      </section>

      <div className="dashboard-lower-grid">
        <section className="panel cashflow-panel">
          <div className="panel-head"><div><p className="eyebrow">LIQUIDEZ</p><h2>Flujo de caja</h2><p>Cobros y pagos del período</p></div></div>
          {data ? <Cashflow data={data.cashflow} /> : <div className="cashflow-skeleton skeleton" />}
        </section>

        <section className="panel alerts-panel">
          <div className="panel-head"><div><p className="eyebrow">ATENCIÓN</p><h2>Pendientes clave</h2><p>Lo que requiere seguimiento</p></div></div>
          {data && <div className="manager-alerts">
            <AlertLink href="/app/tasks" icon={ListTodo} value={data.alerts.pendingTasks} label="Tareas pendientes" detail="Revisar asignaciones" tone="navy" />
            <AlertLink href="/app/checks" icon={Clock3} value={data.alerts.checksDue} label="Cheques próximos" detail="Vencen dentro de 7 días" tone="red" />
            <AlertLink href="/app/quotes" icon={FileSearch} value={data.alerts.openQuotes} label="Cotizaciones abiertas" detail="Enviadas o en seguimiento" tone="blue" />
            <AlertLink href="/app/clients" icon={Users} value={data.alerts.activeClients} label="Clientes activos" detail="Base comercial" tone="slate" />
          </div>}
        </section>

        <section className="panel quick-panel">
          <div className="panel-head"><div><p className="eyebrow">ACCESOS</p><h2>Gestión rápida</h2><p>Atajos operativos frecuentes</p></div></div>
          <div className="quick-links">
            <QuickLink href="/app/quotes" icon={BriefcaseBusiness} label="Gestionar ventas" />
            <QuickLink href="/app/collections" icon={CircleDollarSign} label="Registrar cobranzas" />
            <QuickLink href="/app/expenses" icon={WalletCards} label="Cargar gastos" />
            <QuickLink href="/app/tasks" icon={CheckCircle2} label="Revisar tareas" />
          </div>
        </section>
      </div>
    </div>
  );
}

function KpiCard({ href, label, value, format, detail, help, comparison, icon: Icon, tone }: {
  href: string; label: string; value: number; format: (value: number) => string; detail?: string; help: string; comparison?: number | null; icon: typeof HardHat; tone: string;
}) {
  return <Link href={href} className={`kpi-card ${tone}`} title={detail ? `${label}: ${detail}` : `Ver ${label.toLowerCase()}`}>
    <div className="kpi-card-top"><span className="kpi-icon"><Icon size={20} /></span>{comparison !== undefined && <TrendBadge value={comparison} />}</div>
    <span className="kpi-label">{label}</span>
    <strong><AnimatedNumber value={value} format={format} /></strong>
    {detail && <span className="kpi-exact">Exacto: {detail}</span>}
    <small>{help}</small>
  </Link>;
}

function TrendBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="trend neutral">Sin base</span>;
  const positive = value >= 0;
  return <span className={positive ? "trend positive" : "trend negative"}>{positive ? <TrendingUp /> : <TrendingDown />}{Math.abs(value)}%</span>;
}

function AnimatedNumber({ value, format }: { value: number; format: (value: number) => string }) {
  const [visible, setVisible] = useState(0);
  const last = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      last.current = value;
      const reducedFrame = requestAnimationFrame(() => setVisible(value));
      return () => cancelAnimationFrame(reducedFrame);
    }
    const from = last.current;
    const difference = value - from;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (time: number) => {
      const progress = Math.min((time - startedAt) / 850, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVisible(from + difference * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else last.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return format(visible);
}

function MonthlyChart({ points }: { points: MonthlyPoint[] }) {
  const series = [
    { key: "salesCents" as const, label: "Ventas", className: "sales" },
    { key: "invoicedCents" as const, label: "Facturación", className: "invoiced" },
    { key: "collectedCents" as const, label: "Cobranzas", className: "collected" },
    { key: "expenseCents" as const, label: "Gastos", className: "expense" },
  ];
  const max = Math.max(0, ...points.flatMap(point => series.map(item => point[item.key])));
  if (!max) return <div className="empty-state dashboard-empty"><BarChart3 /><p>Todavía no hay movimientos para graficar.</p></div>;

  const width = 820; const height = 300; const top = 20; const bottom = 48; const left = 34; const chartHeight = height - top - bottom;
  const usableWidth = width - left - 12; const groupWidth = usableWidth / points.length; const barWidth = Math.min(13, groupWidth / 5.2);
  return <div className="manager-chart">
    <div className="chart-legend manager-legend">{series.map(item => <span key={item.key}><i className={item.className} /> {item.label}</span>)}</div>
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Comparación mensual de ventas, facturación, cobranzas y gastos">
        {[0, 0.25, 0.5, 0.75, 1].map(level => {
          const y = top + chartHeight - chartHeight * level;
          return <g key={level}><line className="chart-gridline" x1={left} x2={width - 8} y1={y} y2={y} /><text className="chart-axis-label" x={left - 6} y={y + 3} textAnchor="end">{level === 0 ? "0" : compactAxis(max * level)}</text></g>;
        })}
        {points.map((point, pointIndex) => {
          const startX = left + pointIndex * groupWidth + (groupWidth - barWidth * series.length) / 2;
          return <g key={point.period}>
            {series.map((item, seriesIndex) => {
              const value = point[item.key];
              const barHeight = Math.max(value > 0 ? 2 : 0, value / max * chartHeight);
              return <rect key={item.key} className={`chart-bar ${item.className}`} x={startX + seriesIndex * barWidth} y={top + chartHeight - barHeight} width={Math.max(3, barWidth - 2)} height={barHeight} rx="3" style={{ animationDelay: `${pointIndex * 45 + seriesIndex * 30}ms` }}><title>{`${item.label} ${monthLabel(point.period)}: ${money(value)}`}</title></rect>;
            })}
            <text className="chart-month" x={left + pointIndex * groupWidth + groupWidth / 2} y={height - 17} textAnchor="middle">{monthLabel(point.period)}</text>
          </g>;
        })}
      </svg>
    </div>
  </div>;
}

function ReceivableDonut({ data }: { data: DashboardData["receivables"] }) {
  const total = Math.max(data.totalCents, 1);
  const overdue = data.overdueCents / total * 100;
  const dueSoon = data.dueSoonCents / total * 100;
  const background = data.totalCents ? `conic-gradient(var(--brand-red) 0 ${overdue}%, var(--warning) ${overdue}% ${overdue + dueSoon}%, var(--brand-navy-light) ${overdue + dueSoon}% 100%)` : "var(--surface-muted)";
  return <div className="receivable-content">
    <div className="donut-chart" style={{ background }} role="img" aria-label={`Cuentas por cobrar: ${money(data.totalCents)}`}>
      <div><span>Total</span><strong><AnimatedNumber value={data.totalCents} format={compactMoney} /></strong></div>
    </div>
    <div className="receivable-legend">
      <LegendRow color="red" label="Vencido" value={data.overdueCents} />
      <LegendRow color="amber" label="Próximos 30 días" value={data.dueSoonCents} />
      <LegendRow color="blue" label="A futuro" value={data.futureCents} />
    </div>
    <Link className="panel-action" href="/app/collections">Gestionar cobranzas <ArrowRight size={15} /></Link>
  </div>;
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return <div><span><i className={color} />{label}</span><b>{compactMoney(value)}</b></div>;
}

function WorkCard({ work }: { work: ActiveWork }) {
  const progress = Math.min(100, Math.max(0, work.progress || 0));
  const spent = work.budgetCents ? Math.min(100, Math.round(work.costCents / work.budgetCents * 100)) : 0;
  const style = { "--work-progress": `${progress}%`, "--budget-progress": `${spent}%` } as CSSProperties;
  return <Link href={`/app/works/${work._id}`} className="work-progress-card" style={style}>
    <div className="work-card-top"><span className="work-number">{work.code}</span><span className="badge en_curso">{titleCase(work.status)}</span></div>
    <div><h3>{work.name}</h3><p><CalendarDays size={14} /> {work.endDate ? `Fin previsto ${date(work.endDate)}` : "Sin fecha de cierre"}</p></div>
    <div className="work-progress-heading"><span>Avance de obra</span><b><AnimatedNumber value={progress} format={value => `${Math.round(value)}%`} /></b></div>
    <div className="work-progress-track"><i /></div>
    <div className="budget-row"><span><small>Presupuesto</small><b>{compactMoney(work.budgetCents)}</b></span><span><small>Ejecutado</small><b>{spent}%</b></span></div>
    <div className="budget-track"><i /></div>
  </Link>;
}

function Cashflow({ data }: { data: DashboardData["cashflow"] }) {
  const max = Math.max(data.incomeCents, data.expenseCents, 1);
  return <div className="cashflow-content">
    <div className="cash-balance"><span>Resultado del período</span><strong className={data.balanceCents >= 0 ? "positive" : "negative"}><AnimatedNumber value={data.balanceCents} format={compactMoney} /></strong><small>{data.balanceCents >= 0 ? "Flujo positivo" : "Flujo negativo"}</small></div>
    <div className="cash-bars">
      <div><span><b>Ingresos</b><strong>{compactMoney(data.incomeCents)}</strong></span><i><em className="income" style={{ width: `${data.incomeCents / max * 100}%` }} /></i></div>
      <div><span><b>Egresos</b><strong>{compactMoney(data.expenseCents)}</strong></span><i><em className="outcome" style={{ width: `${data.expenseCents / max * 100}%` }} /></i></div>
    </div>
  </div>;
}

function AlertLink({ href, icon: Icon, value, label, detail, tone }: { href: string; icon: typeof Users; value: number; label: string; detail: string; tone: string }) {
  return <Link href={href}><span className={`manager-alert-icon ${tone}`}><Icon /></span><span><b>{value} {label.toLowerCase()}</b><small>{detail}</small></span><ArrowUpRight /></Link>;
}

function QuickLink({ href, icon: Icon, label }: { href: string; icon: typeof Users; label: string }) {
  return <Link href={href}><span><Icon /></span><b>{label}</b><ArrowRight /></Link>;
}

function percentage(part: number, total: number) {
  return total ? Math.round(part / total * 100) : 0;
}

function periodLabel(period: DashboardData["period"]) {
  if (period.range === "custom") return `${date(period.from)} al ${date(period.to)}`;
  return period.range === "1m" ? "Último mes" : `Últimos ${period.months} meses`;
}

function monthLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { month: "short" }).format(new Date(year, month - 1, 1)).replace(".", "");
}

function compactAxis(cents: number) {
  return new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 0 }).format(cents / 100);
}
