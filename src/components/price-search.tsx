"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, History, Search, Trophy, TriangleAlert } from "lucide-react";
import { date, money, preciseMoney, qty } from "@/lib/format";
import { measureLabels, withVat as addVat, type PriceRow } from "@/lib/price-lists";

/* ─────────────────────────────────────────────────────────────────────────────
   Buscador de precios y la tabla de precios que comparte con la pantalla de
   cada proveedor. Los importes llegan sin IVA; el botón "Con IVA" se lo suma
   en pantalla, sin volver a pedir nada al servidor.
   ───────────────────────────────────────────────────────────────────────────── */

/** Dos botones, "Sin IVA" y "Con IVA": se ve cuál está elegido sin tener que leer un interruptor. */
export function VatToggle({ withVat, onChange }: { withVat: boolean; onChange: (value: boolean) => void }) {
  return <div className="vat-toggle" role="group" aria-label="Cómo mostrar los precios">
    <button type="button" aria-pressed={!withVat} className={!withVat ? "active" : ""} onClick={() => onChange(false)}>Sin IVA</button>
    <button type="button" aria-pressed={withVat} className={withVat ? "active" : ""} onClick={() => onChange(true)}>Con IVA</button>
  </div>;
}

/** Cuánto subió o bajó respecto de la lista anterior. Subir se pinta de rojo: es plata que sale. */
function Variation({ previous, current }: { previous: number | null; current: number }) {
  if (!previous || previous === current) return null;
  const change = (current / previous - 1) * 100;
  return <small className={change > 0 ? "price-variation up" : "price-variation down"} title={`Antes: ${money(previous)} de lista`}>
    {change > 0 ? "▲" : "▼"} {qty(Math.abs(change), 1)} %
  </small>;
}

/** Los precios que tuvo el producto en cada lista del proveedor. */
function PriceHistory({ id, withVat }: { id: string; withVat: boolean }) {
  const [items, setItems] = useState<Array<{ listId: string; validFrom: string; listCents: number; current: boolean }> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/prices/${id}/history`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo cargar la historia del precio");
        setItems(body.items || []);
      })
      .catch(problem => { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : "No se pudo cargar la historia del precio"); });
    return () => controller.abort();
  }, [id]);

  if (error) return <p className="price-history-state error-text">{error}</p>;
  if (!items) return <p className="price-history-state">Cargando…</p>;
  if (items.length < 2) return <p className="price-history-state">Es la primera lista de este proveedor que trae este producto: todavía no hay precios anteriores para comparar.</p>;
  const show = (cents: number) => withVat ? addVat(cents) : cents;
  return <ol className="price-history">{items.map((item, index) => <li key={item.listId} className={item.current ? "current" : ""}>
    <span>{date(item.validFrom)}{item.current && <em>vigente</em>}</span>
    <b>{money(show(item.listCents))}</b>
    <Variation previous={index ? items[index - 1].listCents : null} current={item.listCents} />
  </li>)}</ol>;
}

/**
 * La tabla de precios. En el buscador muestra de qué proveedor es cada fila;
 * en la pantalla del proveedor, el rubro y la disponibilidad.
 */
export function PriceTable({ rows, withVat, mode }: { rows: PriceRow[]; withVat: boolean; mode: "search" | "supplier" }) {
  const [openHistory, setOpenHistory] = useState("");
  const show = (cents: number) => withVat ? addVat(cents) : cents;
  return <div className="table-scroll"><table className="price-table"><thead><tr>
    <th>Producto</th>
    {mode === "search" ? <th>Proveedor</th> : <th>Rubro</th>}
    <th>Presentación</th>
    <th className="num">Precio de lista</th>
    <th className="num">Tu precio</th>
    <th className="num">Por unidad</th>
    <th>{mode === "search" ? "Lista" : "Disponibilidad"}</th>
    <th />
  </tr></thead><tbody>{rows.map(row => <Fragment key={row._id}>
    <tr className={row.best ? "price-best" : undefined}>
      <td data-label="Producto"><div className="price-product">
        <b>{row.name}</b>
        {row.best && <span className="price-best-chip"><Trophy size={12} /> Mejor precio{row.measure ? ` por ${measureLabels[row.measure.unit]}` : ""}</span>}
        <small>{[row.code && `Cód. ${row.code}`, row.description].filter(Boolean).join(" · ")}</small>
      </div></td>
      {mode === "search"
        ? <td data-label="Proveedor"><div className="price-cell"><Link href={`/app/suppliers/${row.supplierId}`}>{row.supplierName}</Link><small>{row.discountPct ? `Descuento ${qty(row.discountPct)} %` : "Sin descuento cargado"}</small></div></td>
        : <td data-label="Rubro"><div className="price-cell">{row.category || "—"}{row.subcategory && <small>{row.subcategory}</small>}</div></td>}
      <td data-label="Presentación"><div className="price-cell">{row.presentation || "—"}{row.minSale && <small>Mínimo: {row.minSale}</small>}</div></td>
      <td data-label="Precio de lista" className="num"><div className="price-cell">{money(show(row.listCents))}<Variation previous={row.previousCents} current={row.listCents} /></div></td>
      <td data-label="Tu precio" className="num"><strong className="price-own">{money(show(row.ownCents))}</strong></td>
      <td data-label="Por unidad" className="num">{row.measure
        ? <span className="price-unit">{preciseMoney(show(row.ownCents) / row.measure.qty)} <small>/ {measureLabels[row.measure.unit]}</small></span>
        : <span className="price-unit empty" title="La presentación no dice cuánto trae, o lo dice de una forma que no se puede comparar">—</span>}</td>
      <td data-label={mode === "search" ? "Lista" : "Disponibilidad"}><div className="price-cell">
        {mode === "search" && <span>Del {date(row.validFrom)}</span>}
        {row.stale && <span className="price-stale" title="La lista tiene más de tres meses: conviene pedir la nueva"><TriangleAlert size={12} /> Lista vieja</span>}
        {row.kindLabel ? <small title={row.kindLabel}>{row.kindLabel}</small> : mode === "supplier" && <small>—</small>}
      </div></td>
      <td className="row-actions"><button type="button" title="Ver cómo cambió el precio" aria-expanded={openHistory === row._id} onClick={() => setOpenHistory(current => current === row._id ? "" : row._id)}><History size={16} /></button></td>
    </tr>
    {openHistory === row._id && <tr className="price-history-row"><td colSpan={8}>
      <p className="eyebrow">PRECIO DE LISTA EN CADA LISTA</p>
      <PriceHistory id={row._id} withVat={withVat} />
    </td></tr>}
  </Fragment>)}</tbody></table></div>;
}

type SearchResult = { rows: PriceRow[]; total: number; lists: number };
type Sort = "relevance" | "price" | "unit";

export function PriceSearch() {
  const [query, setQuery] = useState("");
  const [withVat, setWithVat] = useState(false);
  const [sort, setSort] = useState<Sort>("relevance");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetch(`/api/prices/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(async response => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "No se pudo buscar");
          setResult(body); setError("");
        })
        .catch(problem => { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : "No se pudo buscar"); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const rows = useMemo(() => {
    const list = [...(result?.rows || [])];
    const unitCost = (row: PriceRow) => row.measure ? row.ownCents / row.measure.qty : Number.POSITIVE_INFINITY;
    if (sort === "price") list.sort((a, b) => a.ownCents - b.ownCents);
    // Lo que no se puede llevar a una medida va al final: no hay con qué compararlo.
    if (sort === "unit") list.sort((a, b) => unitCost(a) - unitCost(b) || a.ownCents - b.ownCents);
    return list;
  }, [result, sort]);

  const searching = query.trim().length > 0;
  const noLists = result !== null && result.lists === 0;

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">COMPRAS Y STOCK</p>
      <h1>Buscador de precios</h1>
      <p>Buscá un producto y compará lo que cobra cada proveedor, con el descuento de cada uno ya aplicado.</p>
    </div></div>

    <div className="toolbar price-toolbar">
      <div className="search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} autoFocus
        placeholder="Producto o código: techos 5000, membrana, JUE91…" aria-label="Buscar producto o código" /></div>
      <VatToggle withVat={withVat} onChange={setWithVat} />
      <label className="price-sort"><span>Ordenar</span><select value={sort} onChange={event => setSort(event.target.value as Sort)}>
        <option value="relevance">Por nombre</option>
        <option value="price">Menor precio</option>
        <option value="unit">Menor precio por kg / litro / m²</option>
      </select></label>
    </div>
    {error && <div className="notice error">{error}</div>}

    {searching && result && result.rows.length > 0 && <p className="price-count">
      {result.total > result.rows.length ? `Se muestran ${result.rows.length} de ${result.total} productos: escribí algo más para achicar la búsqueda.` : `${result.total} ${result.total === 1 ? "producto" : "productos"}`}
      {" · "}Precios {withVat ? "con IVA (21 %)" : "sin IVA"}{" · "}“Tu precio” ya tiene el descuento de cada proveedor.
    </p>}

    <section className="table-panel">
      {noLists
        ? <div className="empty-state"><FileSpreadsheet size={28} /><p>Todavía no hay listas de precios cargadas.</p><Link href="/app/suppliers">Subí la primera desde Proveedores → Listas de precios</Link></div>
        : !searching
          ? <div className="empty-state"><Search size={28} /><p>Escribí un producto o un código para comparar los precios de todas las listas vigentes.</p></div>
          : loading && !result?.rows.length
            ? <div className="loading-state">Buscando…</div>
            : !rows.length
              ? <div className="empty-state"><p>No encontramos “{query.trim()}” en las listas vigentes. Probá con menos palabras o con el código.</p></div>
              : <PriceTable rows={rows} withVat={withVat} mode="search" />}
    </section>
  </>;
}
