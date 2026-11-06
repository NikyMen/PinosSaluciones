"use client";

import { Fragment, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { date, money } from "@/lib/format";
import { cashAccountCompanyShort } from "@/lib/cash-account-kinds";
import type { StatementAccount } from "@/lib/cash-statement";
import { csvAmount, currentMonth, downloadCsv } from "@/components/period-filter";

const periodLabel = (period: string) => { const [year, month] = period.split("-"); return year && month ? `${month}/${year}` : period; };

/**
 * El extracto por caja (pedido de Administración): una caja o un rango de
 * códigos, entre dos fechas, con el saldo anterior, cada movimiento y el saldo
 * final. Débito es lo que sale; Crédito, lo que entra. Se baja a Excel con las
 * mismas columnas que la planilla de Administración.
 */
export function CashStatementView() {
  const [filter, setFilter] = useState(() => { const month = currentMonth(); return { from: month.from, to: month.to, codeFrom: "", codeTo: "" }; });
  const [accounts, setAccounts] = useState<StatementAccount[] | null>(null);
  const [onlyMoving, setOnlyMoving] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(Object.entries(filter).filter(([, value]) => value)).toString();
    fetch(`/api/accounting/cash-statement?${query}`, { signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudo armar el extracto"); return body.accounts as StatementAccount[]; })
      .then(items => { setAccounts(items); setError(""); })
      .catch(problem => { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : "No se pudo armar el extracto"); });
    return () => controller.abort();
  }, [filter]);

  const visible = (accounts || []).filter(account => !onlyMoving || account.rows.length || account.openingCents);
  const label = (account: StatementAccount) => [account.code, account.name].filter(Boolean).join(" · ");

  function exportCsv() {
    const rows: Array<Array<string | number>> = [];
    for (const account of visible) {
      rows.push([label(account), "", "", "Saldo anterior", "", "", "", csvAmount(account.openingCents)]);
      for (const row of account.rows) rows.push([label(account), periodLabel(row.period), date(row.date), row.detail, row.concept, row.debitCents ? csvAmount(row.debitCents) : "", row.creditCents ? csvAmount(row.creditCents) : "", ""]);
      rows.push([label(account), "", "", "Saldo final", "", csvAmount(account.debitCents), csvAmount(account.creditCents), csvAmount(account.closingCents)]);
    }
    downloadCsv(`extracto-por-caja-${filter.from}-${filter.to}.csv`, ["Cuenta", "Período", "Fecha", "Detalle", "Concepto", "Débito", "Crédito", "Saldo"], rows);
  }

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">TESORERÍA</p>
      <h1>Extracto por caja</h1>
      <p>De una caja o de un rango de códigos, con el saldo anterior y el final. Débito es lo que sale; Crédito, lo que entra. El período es el de la factura.</p>
    </div></div>
    <div className="toolbar">
      <div className="period-filter" role="group" aria-label="Filtros del extracto">
        <label><span>Desde el código</span><input type="number" min="1" value={filter.codeFrom} onChange={event => setFilter(current => ({ ...current, codeFrom: event.target.value }))} placeholder="1" /></label>
        <label><span>Hasta el código</span><input type="number" min="1" value={filter.codeTo} onChange={event => setFilter(current => ({ ...current, codeTo: event.target.value }))} placeholder="79" /></label>
        <label><span>Desde</span><input type="date" value={filter.from} onChange={event => setFilter(current => ({ ...current, from: event.target.value }))} /></label>
        <label><span>Hasta</span><input type="date" value={filter.to} onChange={event => setFilter(current => ({ ...current, to: event.target.value }))} /></label>
        <label className="check-inline"><input type="checkbox" checked={onlyMoving} onChange={event => setOnlyMoving(event.target.checked)} /> Sólo las que tienen saldo o movimientos</label>
      </div>
      <button type="button" className="secondary-btn" onClick={exportCsv} disabled={!visible.length}><Download size={17} /> Exportar a Excel</button>
    </div>
    {error && <div className="notice error">{error}</div>}
    <section className="table-panel">
      {!accounts ? <div className="loading-state">Armando el extracto…</div> : !visible.length ? <div className="empty-state"><p>No hay cuentas con movimientos en ese rango.</p></div>
        : <div className="table-scroll"><table className="ledger-table"><thead><tr><th>Período</th><th>Fecha</th><th>Detalle</th><th>Concepto</th><th>Débito</th><th>Crédito</th></tr></thead>
          <tbody>
            {visible.map(account => <Fragment key={account._id}>
              <tr className="statement-account"><td colSpan={4}><span className="account-code">{account.code ?? "—"}</span> <b>{account.name}</b> <span className={`company-badge ${account.company}`}>{cashAccountCompanyShort(account.company)}</span></td>
                <td colSpan={2} data-label="Saldo anterior">Saldo anterior <b>{money(account.openingCents)}</b></td></tr>
              {account.rows.map((row, index) => <tr key={index} className="ledger-detail">
                <td data-label="Período">{periodLabel(row.period)}</td>
                <td data-label="Fecha">{date(row.date)}</td>
                <td data-label="Detalle">{row.detail}</td>
                <td data-label="Concepto">{row.concept || "—"}</td>
                <td data-label="Débito">{row.debitCents ? money(row.debitCents) : ""}</td>
                <td data-label="Crédito">{row.creditCents ? money(row.creditCents) : ""}</td>
              </tr>)}
              <tr className="statement-total"><td colSpan={4}>Saldo final <b>{money(account.closingCents)}</b></td><td data-label="Débito">{money(account.debitCents)}</td><td data-label="Crédito">{money(account.creditCents)}</td></tr>
            </Fragment>)}
          </tbody></table></div>}
    </section>
  </>;
}
