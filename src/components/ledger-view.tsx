"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, Download, TriangleAlert } from "lucide-react";
import { date, money } from "@/lib/format";
import { companyOf } from "@/lib/companies";
import { accountCodeLabels } from "@/lib/account-catalog";
import type { LedgerMovement, LedgerSummary } from "@/lib/accounting";
import { csvAmount, currentMonth, downloadCsv, PeriodFilter, periodQuery, type PeriodValue } from "@/components/period-filter";

const sourceLabels = { caja: "Caja y bancos", recibo: "Recibo", pago: "Pago" };

/**
 * Lo que entró y salió en el período, agrupado por código (CI, GGD, GGI…) y por
 * cuenta del plan. Cada cuenta se abre para ver sus movimientos. Lo cargado
 * antes del plan de cuentas, sin cuenta, aparece aparte para imputarlo.
 */
export function LedgerView() {
  const [period, setPeriod] = useState<PeriodValue>(currentMonth);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [error, setError] = useState("");
  const [openAccount, setOpenAccount] = useState("");
  const [detail, setDetail] = useState<Record<string, LedgerMovement[]>>({});

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/accounting/ledger?${periodQuery(period)}`, { signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudieron leer los movimientos"); return body as LedgerSummary; })
      .then(result => { setSummary(result); setDetail({}); setOpenAccount(""); setError(""); })
      .catch(problem => { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : "No se pudieron leer los movimientos"); });
    return () => controller.abort();
  }, [period]);

  async function toggle(accountId: string) {
    if (openAccount === accountId) return setOpenAccount("");
    setOpenAccount(accountId);
    if (detail[accountId]) return;
    const response = await fetch(`/api/accounting/ledger?${periodQuery(period)}&accountId=${accountId}`);
    const body = await response.json();
    if (response.ok) setDetail(current => ({ ...current, [accountId]: body.items }));
    else setError(body.error || "No se pudo abrir la cuenta");
  }

  function exportCsv() {
    if (!summary) return;
    downloadCsv(`movimientos-por-cuenta-${period.from}-${period.to}.csv`, ["Código", "Cuenta", "Ingresos", "Egresos", "Movimientos"],
      [...summary.lines.map(line => [line.code, line.name, csvAmount(line.inCents), csvAmount(line.outCents), line.count]),
        ...(summary.unassigned.count ? [["—", "Sin cuenta (cargado antes del plan)", csvAmount(summary.unassigned.inCents), csvAmount(summary.unassigned.outCents), summary.unassigned.count]] : [])]);
  }

  const movementRows = (items: LedgerMovement[] | undefined) => !items ? <tr className="ledger-detail"><td colSpan={5}>Cargando…</td></tr>
    : !items.length ? <tr className="ledger-detail"><td colSpan={5}>Sin movimientos en el período.</td></tr>
      : items.map(movement => <tr key={`${movement.source}-${movement._id}`} className="ledger-detail">
        <td data-label="Fecha">{date(movement.date)}</td>
        <td data-label="Detalle"><Link href={movement.href}>{movement.description}</Link><small>{sourceLabels[movement.source]}{movement.cashAccount ? ` · ${movement.cashAccount}` : ""}{movement.company ? ` · ${companyOf(movement.company).short}` : ""}{movement.transferId ? ` · ${movement.transferId}` : ""}</small></td>
        <td data-label="Ingreso">{movement.direction === "ingreso" ? money(movement.amountCents) : ""}</td>
        <td data-label="Egreso">{movement.direction === "egreso" ? money(movement.amountCents) : ""}</td>
        <td />
      </tr>);

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">CONTABILIDAD</p>
      <h1>Movimientos por cuenta</h1>
      <p>Caja y bancos, recibos y pagos del período, agrupados por código y cuenta del plan. Tocá una cuenta para ver sus movimientos.</p>
    </div></div>
    <div className="toolbar">
      <PeriodFilter value={period} onChange={setPeriod} />
      <button type="button" className="secondary-btn" onClick={exportCsv} disabled={!summary?.lines.length}><Download size={17} /> Exportar a Excel</button>
    </div>
    {error && <div className="notice error">{error}</div>}
    {summary && <>
      <div className="price-kpis tracking-kpis">
        <div className="stock-kpi"><span>Ingresos</span><strong>{money(summary.totals.inCents)}</strong><small>Cuentas CI</small></div>
        <div className="stock-kpi"><span>Egresos</span><strong>{money(summary.totals.outCents)}</strong><small>Resto de los códigos</small></div>
        <div className="stock-kpi"><span>Neto</span><strong>{money(summary.totals.inCents - summary.totals.outCents)}</strong><small>Ingresos menos egresos{summary.transfers?.count ? ` · sin ${Math.ceil(summary.transfers.count / 2)} pase${Math.ceil(summary.transfers.count / 2) === 1 ? "" : "s"} entre cuentas (${money(summary.transfers.outCents)})` : ""}</small></div>
        <div className={summary.unassigned.count ? "stock-kpi alert" : "stock-kpi"}><span>Sin cuenta</span><strong>{summary.unassigned.count}</strong><small>Movimientos de antes del plan</small></div>
      </div>
      {summary.byCode.length > 0 && <div className="ledger-codes">{summary.byCode.map(code => <div key={code.code}><b>{code.code}</b><span>{accountCodeLabels[code.code]}</span><strong>{money(code.inCents || code.outCents)}</strong></div>)}</div>}
      {summary.unassigned.count > 0 && <div className="notice warning"><TriangleAlert size={16} /> Hay {summary.unassigned.count} movimientos del período sin cuenta del plan (cargados antes de que fuera obligatoria). Se imputan editándolos.</div>}
    </>}
    <section className="table-panel">
      {!summary ? <div className="loading-state">Sumando…</div> : !summary.lines.length && !summary.unassigned.count ? <div className="empty-state"><p>No hay movimientos en el período.</p></div>
        : <div className="table-scroll"><table className="ledger-table"><thead><tr><th>Código</th><th>Cuenta</th><th>Ingresos</th><th>Egresos</th><th>Movimientos</th></tr></thead>
          <tbody>
            {summary.lines.map(line => <Fragment key={line.accountId}>
              <tr className="clickable-row" onClick={() => { void toggle(line.accountId); }} tabIndex={0} onKeyDown={event => { if (event.key === "Enter") void toggle(line.accountId); }}>
                <td data-label="Código"><span className="account-code">{line.code}</span></td>
                <td data-label="Cuenta"><ChevronDown size={14} className={openAccount === line.accountId ? "chevron open" : "chevron"} /> {line.name}</td>
                <td data-label="Ingresos">{line.inCents ? money(line.inCents) : "—"}</td>
                <td data-label="Egresos">{line.outCents ? money(line.outCents) : "—"}</td>
                <td data-label="Movimientos">{line.count}</td>
              </tr>
              {openAccount === line.accountId && movementRows(detail[line.accountId])}
            </Fragment>)}
            {summary.unassigned.count > 0 && <>
              <tr className="clickable-row" onClick={() => { void toggle("none"); }}>
                <td data-label="Código">—</td><td data-label="Cuenta"><ChevronDown size={14} className={openAccount === "none" ? "chevron open" : "chevron"} /> Sin cuenta</td>
                <td data-label="Ingresos">{money(summary.unassigned.inCents)}</td><td data-label="Egresos">{money(summary.unassigned.outCents)}</td><td data-label="Movimientos">{summary.unassigned.count}</td>
              </tr>
              {openAccount === "none" && movementRows(detail.none)}
            </>}
          </tbody></table></div>}
    </section>
  </>;
}
