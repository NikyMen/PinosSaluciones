"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, FileSpreadsheet, History, Plus, Search, Trophy, TriangleAlert, X } from "lucide-react";
import { date, money, preciseMoney, qty } from "@/lib/format";
import { discounted, measureLabels, withVat as addVat, type PriceRow } from "@/lib/price-lists";
import { purchaseCart, usePurchaseCart } from "@/lib/purchase-cart";
import { PurchaseCart } from "@/components/purchase-cart";

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

type HistoryEntry = { listId: string; validFrom: string; listCents: number; current: boolean };

/** Los precios que tuvo el producto en cada lista del proveedor, en una ventana aparte. */
function PriceHistoryModal({ row, withVat, onClose }: { row: PriceRow; withVat: boolean; onClose: () => void }) {
  const [items, setItems] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/prices/${row._id}/history`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo cargar la historia del precio");
        setItems(body.items || []);
      })
      .catch(problem => { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : "No se pudo cargar la historia del precio"); });
    return () => controller.abort();
  }, [row._id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const show = (cents: number) => withVat ? addVat(cents) : cents;
  const first = items?.[0];
  const last = items?.[items.length - 1];

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal price-history-modal" role="dialog" aria-modal="true" aria-labelledby="price-history-title">
      <header>
        <div className="modal-title-wrap"><span className="modal-heading-icon"><History /></span><div>
          <p className="eyebrow">HISTORIA DEL PRECIO</p>
          <h2 id="price-history-title">{row.name}</h2>
          <small>{[row.supplierName, row.presentation, row.code && `Cód. ${row.code}`].filter(Boolean).join(" · ")}</small>
        </div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button>
      </header>
      <div className="modal-form-body">
        {error ? <p className="price-history-state error-text">{error}</p>
          : !items ? <p className="price-history-state">Cargando…</p>
          : <>
            {items.length > 1 && first && last && <div className="price-history-summary">
              <span>Desde la lista del {date(first.validFrom)}</span>
              <b className={last.listCents > first.listCents ? "up" : last.listCents < first.listCents ? "down" : ""}>
                {last.listCents === first.listCents ? "Mismo precio" : `${last.listCents > first.listCents ? "Subió" : "Bajó"} ${qty(Math.abs(last.listCents / first.listCents - 1) * 100, 1)} %`}
              </b>
            </div>}
            <div className="table-scroll"><table className="price-history-table"><thead><tr>
              <th>Vigente desde</th><th className="num">Precio de lista</th><th className="num">Tu precio</th><th className="num">Cambio</th>
            </tr></thead><tbody>{items.slice().reverse().map((item, index, list) => {
              const previous = list[index + 1];
              return <tr key={item.listId} className={item.current ? "current" : ""}>
                <td>{date(item.validFrom)}{item.current && <em>vigente</em>}</td>
                <td className="num">{money(show(item.listCents))}</td>
                <td className="num"><b>{money(show(discounted(item.listCents, row.discountPct)))}</b></td>
                <td className="num">{!previous ? <small className="price-muted">Primera lista</small>
                  : previous.listCents === item.listCents ? <small className="price-muted">Igual</small>
                  : <Variation previous={previous.listCents} current={item.listCents} />}</td>
              </tr>;
            })}</tbody></table></div>
            {items.length < 2 && <p className="price-history-state">Es la primera lista de {row.supplierName} que trae este producto: cuando subas la próxima vas a ver acá cómo cambió.</p>}
          </>}
      </div>
      <footer>
        <span>Precios {withVat ? "con IVA" : "sin IVA"}. “Tu precio” usa el descuento de hoy ({qty(row.discountPct)} %).</span>
        <button type="button" className="secondary-btn" onClick={onClose}>Cerrar</button>
      </footer>
    </section>
  </div>;
}

/**
 * La tabla de precios. En el buscador muestra de qué proveedor es cada fila;
 * en la pantalla del proveedor, el rubro y la disponibilidad. Con `canOrder`
 * cada fila tiene su botón para sumarla al pedido de compra.
 */
export function PriceTable({ rows, withVat, mode, canOrder = false }: { rows: PriceRow[]; withVat: boolean; mode: "search" | "supplier"; canOrder?: boolean }) {
  const [historyFor, setHistoryFor] = useState<PriceRow | null>(null);
  const cart = usePurchaseCart();
  const show = (cents: number) => withVat ? addVat(cents) : cents;
  return <>
    <div className="table-scroll"><table className="price-table"><thead><tr>
      <th>Producto</th>
      {mode === "search" ? <th>Proveedor</th> : <th>Rubro</th>}
      <th>Presentación</th>
      <th className="num">Precio de lista</th>
      <th className="num">Tu precio</th>
      <th className="num">Por unidad</th>
      <th>{mode === "search" ? "Lista" : "Disponibilidad"}</th>
      <th />
    </tr></thead><tbody>{rows.map(row => {
      const inCart = cart.find(line => line.itemId === row._id)?.quantity || 0;
      return <tr key={row._id} className={row.best ? "price-best" : undefined}>
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
        <td className="row-actions">
          <button type="button" className="price-history-btn" title="Ver cómo cambió el precio" aria-label={`Historia del precio de ${row.name}`} onClick={() => setHistoryFor(row)}><History size={16} /></button>
          {canOrder && <button type="button" className={inCart ? "row-action-wide price-cart-btn added" : "row-action-wide price-cart-btn"}
            title={inCart ? "Sumar una unidad más al pedido" : "Agregar al pedido de compra"} onClick={() => purchaseCart.add(row)}>
            {inCart ? <><Check size={15} /> En el pedido: {qty(inCart)}</> : <><Plus size={15} /> Agregar</>}
          </button>}
        </td>
      </tr>;
    })}</tbody></table></div>
    {historyFor && <PriceHistoryModal row={historyFor} withVat={withVat} onClose={() => setHistoryFor(null)} />}
  </>;
}

type Sort = "relevance" | "price" | "unit";
type SearchPage = { rows: PriceRow[]; total: number; lists: number; offset: number };
const PAGE = 100;

function fetchSearchPage(query: string, sort: Sort, offset: number, signal?: AbortSignal) {
  return fetch(`/api/prices/search?q=${encodeURIComponent(query)}&sort=${sort}&offset=${offset}&limit=${PAGE}`, { signal })
    .then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo buscar");
      return body as SearchPage;
    });
}

export function PriceSearch({ canOrder }: { canOrder: boolean }) {
  const [query, setQuery] = useState("");
  const [withVat, setWithVat] = useState(false);
  const [sort, setSort] = useState<Sort>("relevance");
  // `key` dice a qué búsqueda pertenecen las filas: una página que llega tarde no se mezcla con otra búsqueda.
  const [result, setResult] = useState<(SearchPage & { key: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const trimmed = query.trim();
  const key = `${trimmed}|${sort}`;

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetchSearchPage(trimmed, sort, 0, controller.signal)
        .then(page => { setResult({ ...page, key: `${trimmed}|${sort}` }); setError(""); })
        .catch(problem => { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : "No se pudo buscar"); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, trimmed ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [trimmed, sort]);

  async function loadMore() {
    if (!result) return;
    setLoadingMore(true);
    try {
      const page = await fetchSearchPage(trimmed, sort, result.rows.length);
      setResult(current => current && current.key === key ? { ...current, rows: [...current.rows, ...page.rows], total: page.total } : current);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "No se pudieron traer más productos"); }
    finally { setLoadingMore(false); }
  }

  const rows = result?.rows || [];
  const searching = trimmed.length > 0;
  const noLists = result !== null && result.lists === 0;

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">COMPRAS Y STOCK</p>
      <h1>Buscador de precios</h1>
      <p>Todos los productos de las listas vigentes. Buscá uno para comparar lo que cobra cada proveedor, con el descuento de cada uno ya aplicado.</p>
    </div>{canOrder && <PurchaseCart />}</div>

    <div className="toolbar price-toolbar">
      <div className="search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} autoFocus
        placeholder="Producto o código: techos 5000, membrana, JUE91…" aria-label="Buscar producto o código" /></div>
      <VatToggle withVat={withVat} onChange={setWithVat} />
      <label className="price-sort"><span>Ordenar</span><select value={sort} onChange={event => setSort(event.target.value as Sort)}>
        <option value="relevance">{searching ? "Por nombre" : "Por proveedor"}</option>
        <option value="price">Menor precio</option>
        <option value="unit">Menor precio por kg / litro / m²</option>
      </select></label>
    </div>
    {error && <div className="notice error">{error}</div>}

    {result && result.total > 0 && <p className="price-count">
      {searching ? `${result.total} ${result.total === 1 ? "producto encontrado" : "productos encontrados"}` : `${result.total} productos en ${result.lists} ${result.lists === 1 ? "lista vigente" : "listas vigentes"}`}
      {" · "}Precios {withVat ? "con IVA (21 %)" : "sin IVA"}{" · "}“Tu precio” ya tiene el descuento de cada proveedor.
    </p>}

    <section className="table-panel">
      {noLists
        ? <div className="empty-state"><FileSpreadsheet size={28} /><p>Todavía no hay listas de precios cargadas.</p><Link href="/app/suppliers">Subí la primera desde Proveedores → Listas de precios</Link></div>
        : loading && !rows.length
          ? <div className="loading-state">{searching ? "Buscando…" : "Cargando la lista…"}</div>
          : !rows.length
            ? <div className="empty-state"><p>No encontramos “{trimmed}” en las listas vigentes. Probá con menos palabras o con el código.</p></div>
            : <>
              <PriceTable rows={rows} withVat={withVat} mode="search" canOrder={canOrder} />
              {result && rows.length < result.total && <div className="price-more">
                <span>Se ven {rows.length} de {result.total}</span>
                <button type="button" className="secondary-btn" onClick={() => { void loadMore(); }} disabled={loadingMore}>{loadingMore ? "Trayendo…" : `Mostrar ${Math.min(PAGE, result.total - rows.length)} más`}</button>
              </div>}
            </>}
    </section>
  </>;
}
