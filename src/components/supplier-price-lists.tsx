"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Columns3, Download, FileSpreadsheet, FileUp, Percent, Search, TriangleAlert } from "lucide-react";
import { date, dateTime, money, qty } from "@/lib/format";
import { DateInput, FileDrop } from "@/components/fields";
import { PriceTable, VatToggle } from "@/components/price-search";
import { PurchaseCart } from "@/components/purchase-cart";
import { discounted, priceFieldLabels, priceFields, searchTextOf, searchTokens, withVat as addVat, type ColumnMap, type PriceLayout, type PriceRow } from "@/lib/price-lists";

type Summary = { total?: number; added: number; up: number; down: number; same: number; removed: number };
type SupplierInfo = { _id: string; name: string; contactName: string; phone: string; email: string; discountPct: number; hasSavedFormat: boolean };
type ListInfo = { _id: string; validFrom: string; fileName?: string; file?: string; itemCount: number; summary?: Summary; userName?: string; createdAt: string; current: boolean; pricesIncludeVat: boolean };
type Data = { supplier: SupplierInfo; lists: ListInfo[]; items: PriceRow[] };
type SheetPreview = { name: string; rows: string[][] };
type Preview = {
  sheets: SheetPreview[]; layout: PriceLayout; source: "auto" | "saved" | "manual";
  validFrom: string; detectedVat: boolean | null; pricesIncludeVat: boolean; itemCount: number;
  skipped: Array<{ row: number; text: string }>; skippedCount: number;
  current: { validFrom: string; itemCount: number } | null;
  summary: Summary;
  changes: Array<{ code: string; name: string; presentation: string; previousCents: number; listCents: number }>;
  sample: Array<{ code: string; name: string; presentation: string; category: string; listCents: number }>;
};

const sourceLabels: Record<Preview["source"], string> = {
  auto: "Las columnas se reconocieron solas",
  saved: "Se usaron las columnas guardadas para este proveedor",
  manual: "Se usan las columnas que marcaste",
};

const columnLetter = (index: number) => String.fromCharCode(65 + index);

/**
 * La pantalla de listas de un proveedor: el descuento que nos hace, subir la
 * lista nueva (primero se revisa, después se guarda), los productos de la
 * vigente y todas las listas que se subieron antes.
 */
export function SupplierPriceLists({ id, canEdit, canOrder }: { id: string; canEdit: boolean; canOrder: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"" | "preview" | "confirm" | "discount">("");
  const [discountText, setDiscountText] = useState("");
  // El archivo elegido viaja dos veces: para revisarlo y para guardarlo.
  const [file, setFile] = useState<File | null>(null);
  const [uploadKey, setUploadKey] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapper, setMapper] = useState<{ sheets: SheetPreview[]; layout: PriceLayout; reason: "unknown" | "adjust" } | null>(null);
  const [manualLayout, setManualLayout] = useState<PriceLayout | null>(null);
  const [validFrom, setValidFrom] = useState("");
  const [pricesIncludeVat, setPricesIncludeVat] = useState(false);
  const [withVat, setWithVat] = useState(false);
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/suppliers/${id}/price-lists`);
    const result = await response.json();
    if (!response.ok) { setError(result.error || "No se pudo cargar el proveedor"); return; }
    setData(result);
    setDiscountText(qty(result.supplier.discountPct));
  }, [id]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function saveDiscount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(discountText.replace(/\./g, "").replace(",", ".") || 0);
    if (!Number.isFinite(value) || value < 0 || value > 100) return setError("El descuento tiene que estar entre 0 y 100 %");
    setBusy("discount"); setError(""); setNotice("");
    const response = await fetch(`/api/suppliers/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ discountPct: value }) });
    const result = await response.json();
    setBusy("");
    if (!response.ok) return setError(result.error || "No se pudo guardar el descuento");
    setNotice(`Descuento guardado: ${qty(result.discountPct)} %. Los precios de todas las listas ya lo tienen aplicado.`);
    await load();
  }

  async function requestPreview(target: File, layout: PriceLayout | null, options: { vat?: boolean; from?: string } = {}) {
    setBusy("preview"); setError(""); setNotice("");
    const form = new FormData();
    form.set("file", target);
    form.set("mode", "preview");
    if (layout) form.set("layout", JSON.stringify(layout));
    if (options.vat !== undefined) form.set("pricesIncludeVat", String(options.vat));
    if (options.from) form.set("validFrom", options.from);
    try {
      const response = await fetch(`/api/suppliers/${id}/price-lists`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo leer la lista");
      if (result.needsMapping) {
        setPreview(null);
        setMapper({ sheets: result.sheets, layout: layout || { sheet: result.sheets[0]?.name || "", headerRow: 0, columns: {} }, reason: "unknown" });
        return;
      }
      setMapper(null);
      setPreview(result);
      setValidFrom(result.validFrom);
      setPricesIncludeVat(result.pricesIncludeVat);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "No se pudo leer la lista"); }
    finally { setBusy(""); }
  }

  function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = new FormData(event.currentTarget).get("file");
    if (!(selected instanceof File) || !selected.size) return setError("Elegí el Excel de la lista");
    setFile(selected);
    setManualLayout(null);
    void requestPreview(selected, null);
  }

  function cancelUpload() {
    setFile(null); setPreview(null); setMapper(null); setManualLayout(null); setUploadKey(key => key + 1);
  }

  async function confirmImport() {
    if (!file || !preview) return;
    if (!validFrom) return setError("Poné desde qué fecha vale la lista");
    setBusy("confirm"); setError(""); setNotice("");
    const form = new FormData();
    form.set("file", file);
    form.set("mode", "confirm");
    form.set("validFrom", validFrom);
    form.set("pricesIncludeVat", String(pricesIncludeVat));
    if (manualLayout) form.set("layout", JSON.stringify(manualLayout));
    try {
      const response = await fetch(`/api/suppliers/${id}/price-lists`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo guardar la lista");
      const summary = result.summary as Summary;
      setNotice(`Lista guardada: ${summary.total} productos, vigente desde el ${date(`${validFrom}T00:00:00.000Z`)}. ${changeText(summary)}`);
      cancelUpload();
      await load();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "No se pudo guardar la lista"); }
    finally { setBusy(""); }
  }

  const categories = useMemo(() => [...new Set((data?.items || []).map(item => item.category).filter(Boolean))], [data]);
  const rows = useMemo(() => {
    const tokens = searchTokens(filter);
    return (data?.items || []).filter(item => (!category || item.category === category) && tokens.every(token => searchTextOf(item).includes(token)));
  }, [data, filter, category]);

  if (!data) return <div className="loading-state">{error || "Cargando proveedor…"}</div>;
  const { supplier, lists } = data;
  const current = lists.find(list => list.current);
  const discountValue = Number(discountText.replace(/\./g, "").replace(",", ".") || 0);
  const olderThanCurrent = preview?.current && validFrom && validFrom < String(preview.current.validFrom).slice(0, 10);

  return <>
    <Link href="/app/suppliers" className="back-link"><ArrowLeft /> Volver a proveedores</Link>
    <div className="page-heading"><div>
      <p className="eyebrow">PROVEEDOR · LISTAS DE PRECIOS</p>
      <h1>{supplier.name}</h1>
      <p>{current ? `Lista vigente desde el ${date(current.validFrom)} · ${current.itemCount} productos` : "Todavía no tiene listas de precios cargadas"}{supplier.contactName ? ` · Contacto: ${supplier.contactName}` : ""}</p>
    </div>
      <div className="price-heading-actions">
        <Link className="secondary-btn" href="/app/precios"><Search size={17} /> Buscador de precios</Link>
        {canOrder && <PurchaseCart />}
      </div>
    </div>
    {error && <div className="notice error">{error}</div>}
    {notice && <div className="notice success">{notice}</div>}

    <div className="price-top-grid">
      <section className="panel price-discount">
        <div className="panel-head"><div className="section-title"><Percent /><div><h2>Descuento acordado</h2><p>Se resta de todas sus listas. Si cambia, los precios se recalculan solos.</p></div></div></div>
        <form className="price-discount-body" onSubmit={saveDiscount}>
          <div className="percent-input"><input inputMode="decimal" value={discountText} disabled={!canEdit} aria-label="Descuento en porcentaje"
            onChange={event => setDiscountText(event.target.value.replace(/[^\d,.]/g, ""))} /><Percent size={15} /></div>
          {canEdit && <button className="primary-btn" disabled={busy === "discount" || discountValue === supplier.discountPct}>{busy === "discount" ? "Guardando…" : "Guardar"}</button>}
          <p className="price-discount-example">
            {Number.isFinite(discountValue) && discountValue >= 0 && discountValue <= 100
              ? <>Con {qty(discountValue)} %, un producto de {money(10_000_000)} de lista te sale <b>{money(discounted(10_000_000, discountValue))}</b> sin IVA, {money(addVat(discounted(10_000_000, discountValue)))} con IVA.</>
              : "Poné un número entre 0 y 100."}
          </p>
        </form>
      </section>

      {canEdit && <section className="panel price-upload">
        <div className="panel-head"><div className="section-title"><FileUp /><div><h2>Subir lista nueva</h2><p>El Excel tal como lo manda el proveedor. Antes de guardar vas a ver qué cambia.</p></div></div></div>
        <form className="price-upload-body" key={uploadKey} onSubmit={review}>
          <FileDrop name="file" accept=".xlsx" formats="Excel .xlsx, hasta 10 MB" />
          <button className="primary-btn" disabled={busy === "preview"}>{busy === "preview" ? "Leyendo la lista…" : "Revisar la lista"}</button>
        </form>
      </section>}
    </div>

    {mapper && file && <ColumnMapper key={`${uploadKey}-${mapper.reason}-${mapper.layout.sheet}`} sheets={mapper.sheets} initial={mapper.layout} reason={mapper.reason} busy={busy === "preview"}
      onCancel={() => { if (mapper.reason === "unknown") cancelUpload(); else setMapper(null); }}
      onApply={layout => { setManualLayout(layout); void requestPreview(file, layout, { from: validFrom || undefined }); }} />}

    {preview && file && !mapper && <section className="panel price-preview">
      <div className="panel-head">
        <div className="section-title"><FileSpreadsheet /><div><h2>Revisá la lista antes de guardarla</h2><p>{file.name} · hoja “{preview.layout.sheet}” · títulos en la fila {preview.layout.headerRow + 1} · {sourceLabels[preview.source]}</p></div></div>
        <button type="button" className="secondary-btn" onClick={() => setMapper({ sheets: preview.sheets, layout: preview.layout, reason: "adjust" })}><Columns3 size={16} /> Ajustar columnas</button>
      </div>
      <div className="price-preview-body">
        <div className="form-grid">
          <label><span>Vigente desde *<em className="field-hint">{preview.validFrom ? "La tomamos de la planilla; corregila si no es" : "La planilla no la dice: ponela a mano"}</em></span>
            <DateInput key={`${uploadKey}-${preview.validFrom}`} name="validFrom" defaultValue={validFrom} required onValueChange={setValidFrom} /></label>
          <label><span>Los precios de la planilla vienen<em className="field-hint">{preview.detectedVat === false ? "La planilla dice «sin IVA»" : preview.detectedVat === true ? "La planilla dice «con IVA»" : "La planilla no lo aclara"}</em></span>
            <select value={pricesIncludeVat ? "true" : "false"} onChange={event => { const vat = event.target.value === "true"; setPricesIncludeVat(vat); void requestPreview(file, manualLayout, { vat, from: validFrom || undefined }); }}>
              <option value="false">Sin IVA</option>
              <option value="true">Con IVA (se lo sacamos al guardar)</option>
            </select></label>
        </div>

        {olderThanCurrent && <p className="convert-warning"><TriangleAlert size={17} /><span>Ya hay una lista vigente desde el {date(String(preview.current!.validFrom))}, más nueva que esta. Si la fecha está bien, esta lista no se puede cargar: revisá que sea el archivo correcto.</span></p>}

        <div className="price-kpis">
          <div className="stock-kpi"><span>Productos leídos</span><strong>{preview.itemCount}</strong></div>
          {preview.current ? <>
            <div className="stock-kpi"><span>Nuevos</span><strong>{preview.summary.added}</strong></div>
            <div className="stock-kpi"><span>Cambian de precio</span><strong>{preview.summary.up + preview.summary.down}</strong><small>{preview.summary.up} suben · {preview.summary.down} bajan · {preview.summary.same} igual</small></div>
            <div className={preview.summary.removed ? "stock-kpi alert" : "stock-kpi"}><span>Ya no están</span><strong>{preview.summary.removed}</strong><small>Estaban en la lista vigente ({preview.current.itemCount})</small></div>
          </> : <div className="stock-kpi price-kpi-wide"><span>Primera lista</span><strong>—</strong><small>Es la primera lista de este proveedor: no hay con qué comparar.</small></div>}
        </div>

        {preview.current && !preview.summary.added && !preview.summary.up && !preview.summary.down && !preview.summary.removed && <p className="convert-warning"><TriangleAlert size={17} /><span>Esta lista tiene los mismos precios que la vigente. Fijate si no es el mismo archivo.</span></p>}

        {preview.changes.length > 0 && <div className="price-preview-table">
          <p className="eyebrow">LOS CAMBIOS MÁS GRANDES</p>
          <div className="table-scroll"><table><thead><tr><th>Producto</th><th>Presentación</th><th className="num">Antes</th><th className="num">Ahora</th><th className="num">Cambio</th></tr></thead>
            <tbody>{preview.changes.map(change => <tr key={`${change.code}-${change.presentation}`}>
              <td><b>{change.name}</b>{change.code && <small className="price-muted"> · {change.code}</small>}</td><td>{change.presentation || "—"}</td>
              <td className="num">{money(change.previousCents)}</td><td className="num">{money(change.listCents)}</td>
              <td className="num"><span className={change.listCents > change.previousCents ? "price-variation up" : "price-variation down"}>{change.listCents > change.previousCents ? "▲" : "▼"} {qty(Math.abs(change.listCents / change.previousCents - 1) * 100, 1)} %</span></td>
            </tr>)}</tbody></table></div>
        </div>}

        {!preview.current && <div className="price-preview-table">
          <p className="eyebrow">ASÍ SE LEYERON LOS PRIMEROS PRODUCTOS</p>
          <div className="table-scroll"><table><thead><tr><th>Código</th><th>Producto</th><th>Presentación</th><th>Rubro</th><th className="num">Precio de lista</th></tr></thead>
            <tbody>{preview.sample.map((item, index) => <tr key={index}><td>{item.code || "—"}</td><td><b>{item.name}</b></td><td>{item.presentation || "—"}</td><td>{item.category || "—"}</td><td className="num">{money(item.listCents)}</td></tr>)}</tbody></table></div>
          <p className="price-muted">Si algo no quedó donde va (el precio en otra columna, el nombre vacío), tocá “Ajustar columnas”.</p>
        </div>}

        {preview.skippedCount > 0 && <details className="price-skipped">
          <summary>{preview.skippedCount} {preview.skippedCount === 1 ? "fila con datos no se leyó" : "filas con datos no se leyeron"} como producto (casi siempre porque no tienen precio)</summary>
          <ul>{preview.skipped.map(item => <li key={item.row}><b>Fila {item.row}:</b> {item.text}</li>)}</ul>
        </details>}
      </div>
      <footer className="price-preview-foot">
        <span>La lista anterior no se borra: queda en el historial.</span>
        <button type="button" className="secondary-btn" onClick={cancelUpload} disabled={busy === "confirm"}>Cancelar</button>
        <button type="button" className="primary-btn" onClick={() => { void confirmImport(); }} disabled={busy !== "" || Boolean(olderThanCurrent) || !validFrom}>
          {busy === "confirm" ? "Guardando…" : `Guardar ${preview.itemCount} productos`}
        </button>
      </footer>
    </section>}

    <section className="panel price-products">
      <div className="panel-head">
        <div className="section-title"><FileSpreadsheet /><div><h2>Productos de la lista vigente</h2><p>{current ? `${rows.length} de ${data.items.length} productos · “Tu precio” ya tiene el ${qty(supplier.discountPct)} % de descuento` : "Cuando subas una lista, sus productos aparecen acá."}</p></div></div>
        <VatToggle withVat={withVat} onChange={setWithVat} />
      </div>
      {data.items.length > 0 && <div className="toolbar price-products-toolbar">
        <div className="search"><Search size={18} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filtrar por nombre, código o descripción…" aria-label="Filtrar productos" /></div>
        {categories.length > 1 && <select className="price-category" value={category} onChange={event => setCategory(event.target.value)} aria-label="Rubro">
          <option value="">Todos los rubros</option>
          {categories.map(option => <option key={option} value={option}>{option}</option>)}
        </select>}
      </div>}
      <div className="table-panel price-products-table">
        {rows.length ? <PriceTable rows={rows} withVat={withVat} mode="supplier" canOrder={canOrder} />
          : <div className="empty-state compact">{data.items.length ? "Ningún producto coincide con el filtro." : "Todavía no hay una lista vigente."}</div>}
      </div>
    </section>

    {lists.length > 0 && <section className="panel price-lists">
      <div className="panel-head"><div className="section-title"><FileSpreadsheet /><div><h2>Listas cargadas</h2><p>Todas las que se subieron, de la más nueva a la más vieja.</p></div></div></div>
      <div className="table-panel"><div className="table-scroll"><table><thead><tr><th>Vigente desde</th><th>Archivo</th><th>Productos</th><th>Cambios</th><th>Subida por</th><th>Estado</th></tr></thead>
        <tbody>{lists.map(list => <tr key={list._id}>
          <td data-label="Vigente desde"><b>{date(list.validFrom)}</b></td>
          <td data-label="Archivo">{list.file ? <a className="price-file" href={list.file} download={list.fileName || true}><Download size={14} /> {list.fileName || "Excel"}</a> : list.fileName || "—"}</td>
          <td data-label="Productos">{list.itemCount}{list.pricesIncludeVat ? " · venía con IVA" : ""}</td>
          <td data-label="Cambios">{list.summary ? changeText(list.summary) : "—"}</td>
          <td data-label="Subida por">{list.userName || "—"} · {dateTime(list.createdAt)}</td>
          <td data-label="Estado"><span className={list.current ? "badge aprobada" : "badge"}>{list.current ? "Vigente" : "Anterior"}</span></td>
        </tr>)}</tbody></table></div></div>
    </section>}
  </>;
}

/** "3 nuevos · 120 suben · 2 bajan · 1 ya no está" — o que es la primera. */
function changeText(summary: Summary) {
  // Sin nada de antes con qué cruzar, todo es "nuevo": es la primera lista.
  if (!summary.up && !summary.down && !summary.same && !summary.removed) return "Primera lista";
  const parts = [
    summary.added && `${summary.added} ${summary.added === 1 ? "nuevo" : "nuevos"}`,
    summary.up && `${summary.up} ${summary.up === 1 ? "sube" : "suben"}`,
    summary.down && `${summary.down} ${summary.down === 1 ? "baja" : "bajan"}`,
    summary.removed && `${summary.removed} ya no ${summary.removed === 1 ? "está" : "están"}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Sin cambios de precio";
}

/**
 * Cuando el Excel no se reconoce solo (o se leyó mal), la persona marca en qué
 * fila están los títulos y qué hay en cada columna. Lo que marca queda
 * guardado para las próximas listas de ese proveedor.
 */
function ColumnMapper({ sheets, initial, reason, busy, onApply, onCancel }: {
  sheets: SheetPreview[]; initial: PriceLayout; reason: "unknown" | "adjust"; busy: boolean;
  onApply: (layout: PriceLayout) => void; onCancel: () => void;
}) {
  const [sheetName, setSheetName] = useState(initial.sheet || sheets[0]?.name || "");
  const [headerRow, setHeaderRow] = useState(initial.headerRow);
  const [columns, setColumns] = useState<ColumnMap>(initial.columns);
  const sheet = sheets.find(candidate => candidate.name === sheetName) || sheets[0];
  const rows = sheet?.rows || [];
  const width = Math.max(1, ...rows.map(row => row.reduce((last, cell, index) => cell ? index + 1 : last, 0)));
  const header = rows[headerRow] || [];
  const mappedColumns = new Map(Object.entries(columns).map(([field, index]) => [index as number, field as keyof ColumnMap]));
  const valid = columns.name !== undefined && columns.price !== undefined;

  function assign(field: keyof ColumnMap, value: string) {
    setColumns(current => {
      const next = { ...current };
      if (value === "") delete next[field];
      else next[field] = Number(value);
      return next;
    });
  }

  return <section className="panel price-mapper">
    <div className="panel-head"><div className="section-title"><Columns3 /><div>
      <h2>{reason === "unknown" ? "Marcá las columnas de esta planilla" : "Ajustá las columnas"}</h2>
      <p>{reason === "unknown" ? "No reconocimos solos los títulos de este Excel. " : ""}Decinos en qué fila están los títulos y qué hay en cada columna. Queda guardado para las próximas listas de este proveedor.</p>
    </div></div></div>
    <div className="price-preview-body">
      <div className="form-grid price-mapper-grid">
        {sheets.length > 1 && <label><span>Hoja</span><select value={sheet?.name || ""} onChange={event => { setSheetName(event.target.value); setHeaderRow(0); setColumns({}); }}>
          {sheets.map(option => <option key={option.name} value={option.name}>{option.name}</option>)}
        </select></label>}
        <label><span>Fila de títulos</span><select value={headerRow} onChange={event => setHeaderRow(Number(event.target.value))}>
          {rows.map((row, index) => <option key={index} value={index}>Fila {index + 1}: {row.filter(Boolean).slice(0, 3).join(" · ").slice(0, 60) || "(vacía)"}</option>)}
        </select></label>
        {priceFields.map(field => <label key={field}><span>{priceFieldLabels[field]}{field === "name" || field === "price" ? " *" : ""}</span>
          <select value={columns[field] ?? ""} onChange={event => assign(field, event.target.value)}>
            <option value="">— No está en la planilla</option>
            {Array.from({ length: width }, (_, index) => <option key={index} value={index}>Columna {columnLetter(index)}{header[index] ? ` · ${header[index].slice(0, 40)}` : ""}</option>)}
          </select></label>)}
      </div>
      <div className="table-scroll price-mapper-sample"><table><thead><tr><th>Fila</th>{Array.from({ length: width }, (_, index) => <th key={index} className={mappedColumns.has(index) ? "mapped" : ""}>{columnLetter(index)}{mappedColumns.has(index) ? ` · ${priceFieldLabels[mappedColumns.get(index)!]}` : ""}</th>)}</tr></thead>
        <tbody>{rows.slice(headerRow, headerRow + 8).map((row, offset) => <tr key={offset} className={offset === 0 ? "header" : ""}>
          <td>{headerRow + offset + 1}</td>
          {row.slice(0, width).map((cell, index) => <td key={index} className={mappedColumns.has(index) ? "mapped" : ""}>{cell}</td>)}
        </tr>)}</tbody></table></div>
    </div>
    <footer className="price-preview-foot">
      <span>Obligatorios: producto y precio.</span>
      <button type="button" className="secondary-btn" onClick={onCancel}>Cancelar</button>
      <button type="button" className="primary-btn" disabled={!valid || busy} onClick={() => onApply({ sheet: sheet?.name || "", headerRow, columns })}>{busy ? "Leyendo…" : "Usar estas columnas"}</button>
    </footer>
  </section>;
}
