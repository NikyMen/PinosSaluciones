"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Calculator, ChevronDown, ChevronRight, History, Layers, LockOpen, Plus, Save, Target, Trash2, Wallet } from "lucide-react";
import { MoneyInput } from "@/components/fields";
import { HistoryModal } from "@/components/record-history";
import { money, preciseMoney, qty as formatQty } from "@/lib/format";
import { computeCascade, defaultCascadeParams, insumosSummary, parseCoef, rubroLabels, solveBenefitPct, targetPriceFromUnitPrice } from "@/lib/cascada";
import type { CascadeParams, Insumo, OverheadLine, QuoteItem, Rubro } from "@/lib/cascada";
import { conceptGroups, findConcept } from "@/lib/cascada-conceptos";

/**
 * El cotizador cascada: la traduccion a pantalla de las 7 planillas de analisis
 * de precios. Cuatro bloques, en el mismo orden en que se leen en el Excel:
 * analisis de precios, gastos generales directos, la cascada, y el precio.
 *
 * Todo se recalcula mientras se tipea con la misma funcion que usa el servidor
 * al guardar (src/lib/cascada.ts), asi lo que se ve es lo que se guarda.
 */

type Quote = {
  _id: string; number: string; title: string; status: string;
  amountCents?: number; estimatedCostCents?: number;
  items?: QuoteItem[]; overheads?: OverheadLine[]; cascade?: Partial<CascadeParams>;
};

/**
 * En el borrador las cantidades son texto, no numero: el coeficiente casi nunca
 * se escribe como coeficiente. La gente piensa en total y divide — "80/5250" son
 * 80 lijas en 5.250 m2 — y eso hay que dejarlo tipear tal cual.
 */
type DraftInsumo = Omit<Insumo, "coefPerUnit"> & { coefText: string };
type DraftItem = Omit<QuoteItem, "qty" | "composition"> & { qtyText: string; composition: DraftInsumo[]; detail?: string };
type DraftOverhead = Omit<OverheadLine, "qty"> & { qtyText: string };

const rubros: Rubro[] = ["MAT", "MO", "EQUIPOS"];
const CERRADAS = ["aprobada", "convertida"];

export function QuoteCascade({ id, canEdit, canForceUnlock }: { id: string; canEdit: boolean; canForceUnlock: boolean }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [overheads, setOverheads] = useState<Record<string, DraftOverhead>>({});
  const [params, setParams] = useState<CascadeParams>(defaultCascadeParams);
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const [targetCents, setTargetCents] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  // Se destraba a propósito, en esta sesión de pantalla: cada guardado con esto
  // activo queda anotado en el historial con una acción distinta ("forzado"),
  // no se pisa en silencio el candado.
  const [forceUnlocked, setForceUnlocked] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/records/quotes/${id}`);
    const result = await response.json();
    if (!response.ok) { setError(result.error || "No se pudo cargar la cotización"); return; }
    setQuote(result);
    setItems((result.items || []).map(toDraftItem));
    setOverheads(Object.fromEntries((result.overheads || []).map((line: OverheadLine) => [line.conceptKey, toDraftOverhead(line)])));
    setParams({ ...defaultCascadeParams, ...(result.cascade || {}) });
    setError("");
  }, [id]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const cargados = useMemo(() => Object.values(overheads), [overheads]);
  const payload = useMemo(() => ({
    items: items.map(toItem),
    overheads: cargados.map(toLine),
    params,
  }), [items, cargados, params]);
  const result = useMemo(() => computeCascade(payload), [payload]);
  const insumos = useMemo(() => insumosSummary(result), [result]);

  const closedByStatus = CERRADAS.includes(String(quote?.status));
  const locked = !canEdit || (closedByStatus && !forceUnlocked);

  function unlock() {
    if (!confirm(`Esta cotización está ${quote?.status}: el precio ya se le mostró a alguien. Vas a poder editar el costeo igual, y va a quedar anotado en el historial con tu nombre y la hora. ¿Seguimos?`)) return;
    setForceUnlocked(true);
    setError("");
  }

  function edit(mutate: () => void) { mutate(); setSaved(""); }

  /* --- items --- */
  function patchItem(index: number, changes: Partial<DraftItem>) {
    edit(() => setItems(current => current.map((item, position) => position === index ? { ...item, ...changes } : item)));
  }
  function patchInsumo(itemIndex: number, insumoIndex: number, changes: Partial<DraftInsumo>) {
    edit(() => setItems(current => current.map((item, position) => position !== itemIndex ? item : {
      ...item, composition: item.composition.map((insumo, spot) => spot === insumoIndex ? { ...insumo, ...changes } : insumo),
    })));
  }

  /* --- gastos generales --- */
  function toggleConcept(key: string) {
    const concept = findConcept(key);
    if (!concept) return;
    edit(() => setOverheads(current => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else next[key] = { conceptKey: key, group: concept.group, label: concept.label, unit: concept.unit, qtyText: "", unitPriceCents: 0, formula: concept.formula, formulaPct: concept.formulaPct };
      return next;
    }));
  }
  function patchOverhead(key: string, changes: Partial<DraftOverhead>) {
    edit(() => setOverheads(current => ({ ...current, [key]: { ...current[key], ...changes } })));
  }

  /* --- el modo inverso: fijo el precio y despejo el beneficio --- */
  function despejarBeneficio(objetivoCents: number) {
    const beneficio = solveBenefitPct(payload, objetivoCents);
    if (beneficio === null) { setError("Todavía no hay costo cargado: no se puede despejar el beneficio"); return; }
    if (beneficio < 0) setError(`Con ese precio el beneficio queda en ${beneficio.toFixed(2)} %: no cubre el costo`);
    else setError("");
    edit(() => setParams(current => ({ ...current, benefitPct: Math.round(beneficio * 1e6) / 1e6 })));
  }

  async function save() {
    setSaving(true); setError("");
    const response = await fetch(`/api/quotes/${id}/cascada`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: payload.items, overheads: payload.overheads, cascade: params, force: forceUnlocked }),
    });
    const body = await response.json();
    if (!response.ok) setError(body.error || "No se pudo guardar el costeo");
    else { setQuote(body.quote); setSaved(`Guardado · precio ${money(body.cascade.priceCents)}${forceUnlocked ? " · destrabado" : ""}`); }
    setSaving(false);
  }

  if (error && !quote) return <div className="notice error">{error}</div>;
  if (!quote) return <div className="loading-state">Cargando la cotización…</div>;

  return <>
    <div className="page-heading cascade-heading">
      <div>
        <Link href="/app/quotes" className="link-btn"><ArrowLeft size={15} /> Volver a cotizaciones</Link>
        <p className="eyebrow">COTIZADOR · ANÁLISIS DE PRECIOS</p>
        <h1>{quote.title}</h1>
        <p>{quote.number} · <span className={`badge ${quote.status}`}>{quote.status}</span></p>
      </div>
      <div className="cascade-actions">
        <div className="cascade-k" title="Precio final dividido el costo directo">
          <small>COEFICIENTE k</small>
          <b>{result.k ? result.k.toFixed(3).replace(".", ",") : "—"}</b>
        </div>
        <button className="secondary-btn" onClick={() => setShowHistory(true)}><History size={16} /> Historial</button>
        {!locked && <button className="primary-btn" onClick={() => { void save(); }} disabled={saving}>
          <Save size={16} /> {saving ? "Guardando…" : "Guardar costeo"}
        </button>}
      </div>
    </div>

    {locked && closedByStatus && canForceUnlock && <div className="notice warn cascade-unlock">
      <div>
        <p className="eyebrow">Solo gerencia</p>
        <p>Esta cotización está <b>{quote.status}</b>: el costeo queda de sólo lectura para que el precio que alguien aprobó no se mueva por debajo sin que se note.</p>
      </div>
      <button className="secondary-btn" onClick={unlock}><LockOpen size={16} /> Destrabar para editar</button>
    </div>}
    {locked && closedByStatus && !canForceUnlock && <div className="notice">Esta cotización está <b>{quote.status}</b>: el costeo queda de sólo lectura para que el precio que alguien aprobó no se mueva por debajo. Sólo gerencia puede destrabarla.</div>}
    {locked && !closedByStatus && <div className="notice">No tenés permiso para editar cotizaciones.</div>}
    {forceUnlocked && closedByStatus && <div className="notice warn">Costeo destrabado a mano: lo que guardes acá va a quedar anotado en el historial, con tu nombre y la hora.</div>}
    {error && <p className="form-error">{error}</p>}
    {saved && <p className="cascade-saved">{saved}</p>}
    {showHistory && <HistoryModal entity="quotes" record={{ _id: id, label: `${quote.number} — ${quote.title}` }} onClose={() => setShowHistory(false)} />}

    {/* ─── 1 · Análisis de precios ─────────────────────────────────────────── */}
    <section className="panel">
      <div className="panel-head"><h2 className="section-title"><Layers size={17} /> Análisis de precios</h2>
        <small>La cantidad de cada insumo es un coeficiente por unidad de obra. Se puede escribir derecho (0,4) o como lo pensás: 80/5250.</small></div>

      {items.map((item, itemIndex) => {
        const computed = result.items[itemIndex];
        return <div className="cascade-item" key={itemIndex}>
          <div className="cascade-item-head">
            <input className="cascade-code" value={item.code || ""} placeholder="1.1." disabled={locked}
              onChange={event => patchItem(itemIndex, { code: event.target.value })} aria-label="Código del ítem" />
            <input className="cascade-name" value={item.name} placeholder="Descripción del ítem" disabled={locked}
              onChange={event => patchItem(itemIndex, { name: event.target.value })} aria-label="Nombre del ítem" />
            <input className="cascade-unit" value={item.unit} placeholder="m2" disabled={locked}
              onChange={event => patchItem(itemIndex, { unit: event.target.value })} aria-label="Unidad" />
            <input className="cascade-qty" inputMode="decimal" value={item.qtyText} placeholder="5250" disabled={locked}
              onChange={event => patchItem(itemIndex, { qtyText: event.target.value })} aria-label="Cantidad de obra" />
            {!locked && <button className="check-delete" aria-label={`Borrar ítem ${item.name}`}
              onClick={() => edit(() => setItems(current => current.filter((_, position) => position !== itemIndex)))}><Trash2 size={14} /></button>}
          </div>

          <div className="table-scroll"><table className="cascade-table"><thead><tr>
            <th>Rubro</th><th>Denominación</th><th>Un.</th><th>Coeficiente</th><th>Precio unitario</th><th>Moneda</th><th>Por unidad</th><th>Total</th><th />
          </tr></thead><tbody>
            {item.composition.map((insumo, insumoIndex) => {
              const line = computed?.composition[insumoIndex];
              return <tr key={insumoIndex}>
                <td data-label="Rubro"><select value={insumo.rubro} disabled={locked} aria-label="Rubro"
                  onChange={event => patchInsumo(itemIndex, insumoIndex, { rubro: event.target.value as Rubro })}>
                  {rubros.map(rubro => <option key={rubro} value={rubro}>{rubro}</option>)}
                </select></td>
                <td data-label="Denominación"><input value={insumo.name} placeholder="Látex acrílico" disabled={locked} aria-label="Denominación"
                  onChange={event => patchInsumo(itemIndex, insumoIndex, { name: event.target.value })} /></td>
                <td data-label="Unidad"><input className="cascade-unit" value={insumo.unit} placeholder="lts" disabled={locked} aria-label="Unidad del insumo"
                  onChange={event => patchInsumo(itemIndex, insumoIndex, { unit: event.target.value })} /></td>
                <td data-label="Coeficiente"><input className="cascade-coef" inputMode="text" value={insumo.coefText} placeholder="0,4 · 80/5250" disabled={locked} aria-label="Coeficiente de consumo"
                  onChange={event => patchInsumo(itemIndex, insumoIndex, { coefText: event.target.value })} />
                  {insumo.coefText.includes("/") && <small className="cascade-hint">= {formatQty(parseCoef(insumo.coefText), 6)}</small>}</td>
                <td data-label="Precio unitario"><MoneyInput name={`p-${itemIndex}-${insumoIndex}`} defaultValue={(insumo.unitPriceCents || 0) / 100} disabled={locked}
                  onValueChange={value => patchInsumo(itemIndex, insumoIndex, { unitPriceCents: Math.round(value * 100) })} /></td>
                <td data-label="Moneda">
                  <select value={insumo.currency || "ARS"} disabled={locked} aria-label="Moneda"
                    onChange={event => patchInsumo(itemIndex, insumoIndex, { currency: event.target.value as "ARS" | "USD" })}>
                    <option value="ARS">$</option><option value="USD">US$</option>
                  </select>
                  {insumo.currency === "USD" && <input className="cascade-fx" inputMode="decimal" value={insumo.fxRate || ""} placeholder="1520" disabled={locked} aria-label="Cotización del dólar"
                    onChange={event => patchInsumo(itemIndex, insumoIndex, { fxRate: Number(event.target.value) || 0 })} />}
                </td>
                <td data-label="Por unidad" className="num">{preciseMoney(line?.unitCostCents || 0)}</td>
                <td data-label="Total" className="num">{money(line?.totalCostCents || 0)}</td>
                <td className="row-actions">{!locked && <button className="check-delete" aria-label={`Borrar ${insumo.name || "insumo"}`}
                  onClick={() => edit(() => setItems(current => current.map((row, position) => position !== itemIndex ? row : { ...row, composition: row.composition.filter((_, spot) => spot !== insumoIndex) })))}><Trash2 size={14} /></button>}</td>
              </tr>;
            })}
            <tr className="settlement-total">
              <td colSpan={6} data-label="Costo del ítem"><b>Costo por {item.unit || "unidad"}</b></td>
              <td className="num"><b>{preciseMoney(computed?.unitCostCents || 0)}</b></td>
              <td className="num"><b>{money(computed?.costCents || 0)}</b></td>
              <td />
            </tr>
          </tbody></table></div>

          {!locked && <button className="secondary-btn compact" onClick={() => edit(() => setItems(current => current.map((row, position) => position !== itemIndex ? row : { ...row, composition: [...row.composition, nuevoInsumo()] })))}>
            <Plus size={15} /> Agregar insumo
          </button>}
        </div>;
      })}

      {!items.length && <div className="empty-state compact"><p>Todavía no hay ítems. Un ítem es una unidad de trabajo cotizable: “Revoque proyectado exterior”, “Armado de balancín”.</p></div>}
      {!locked && <button className="primary-btn" onClick={() => edit(() => setItems(current => [...current, nuevoItem()]))}><Plus size={16} /> Agregar ítem</button>}
    </section>

    {/* ─── 2 · Gastos generales directos ───────────────────────────────────── */}
    <section className="panel">
      <div className="panel-head"><h2 className="section-title"><Wallet size={17} /> Gastos generales directos</h2>
        <small>{cargados.length} de {conceptGroups.reduce((total, group) => total + group.concepts.length, 0)} conceptos cargados · {money(result.ggdCents)}</small></div>

      {conceptGroups.map(group => {
        const cargadosDelGrupo = group.concepts.filter(concept => overheads[concept.key]);
        const abierto = openGroups.includes(group.key);
        return <div className="cascade-group" key={group.key}>
          <button className="cascade-group-head" onClick={() => setOpenGroups(current => abierto ? current.filter(key => key !== group.key) : [...current, group.key])}>
            {abierto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <b>{group.label}</b>
            <small>{cargadosDelGrupo.length ? `${cargadosDelGrupo.length} cargados` : "sin cargar"} · {group.concepts.length} conceptos</small>
          </button>

          {(abierto ? group.concepts : cargadosDelGrupo).map(concept => {
            const line = overheads[concept.key];
            const computed = result.overheads.find(row => row.conceptKey === concept.key);
            if (!line) return abierto ? <div className="cascade-concept off" key={concept.key}>
              <button className="link-btn" disabled={locked} onClick={() => toggleConcept(concept.key)}><Plus size={14} /> {concept.label}</button>
              <small>{concept.unit}</small>
            </div> : null;
            return <div className="cascade-concept" key={concept.key}>
              <span className="cascade-concept-name">{concept.label}</span>
              {line.formula
                ? <label className="percent-input">{line.formula === "mes_hombre" ? "personas × días" : "%"}
                    {line.formula === "mes_hombre"
                      ? <span className="cascade-mes-hombre">
                          <input inputMode="decimal" value={line.personas ?? ""} placeholder={String(result.dotacion.personas || 0)} disabled={locked} aria-label="Personas"
                            onChange={event => patchOverhead(concept.key, { personas: Number(event.target.value) || 0 })} />
                          <input inputMode="decimal" value={line.dias ?? ""} placeholder={String(result.dotacion.dias || 0)} disabled={locked} aria-label="Días"
                            onChange={event => patchOverhead(concept.key, { dias: Number(event.target.value) || 0 })} />
                        </span>
                      : <input inputMode="decimal" value={line.formulaPct ?? ""} disabled={locked} aria-label="Porcentaje"
                          onChange={event => patchOverhead(concept.key, { formulaPct: Number(event.target.value) || 0 })} />}
                  </label>
                : <input className="cascade-qty" inputMode="decimal" value={line.qtyText} placeholder={`cant. (${concept.unit})`} disabled={locked} aria-label={`Cantidad de ${concept.label}`}
                    onChange={event => patchOverhead(concept.key, { qtyText: event.target.value })} />}
              {line.formula !== "impuesto_cheque" && line.formula !== "representacion_tecnica"
                ? <MoneyInput name={`ggd-${concept.key}`} defaultValue={(line.unitPriceCents || 0) / 100} disabled={locked}
                    onValueChange={value => patchOverhead(concept.key, { unitPriceCents: Math.round(value * 100) })} />
                : <span className="cascade-calculado">calculado</span>}
              <strong className="num">{money(computed?.amountCents || 0)}</strong>
              {!locked && <button className="check-delete" aria-label={`Sacar ${concept.label}`} onClick={() => toggleConcept(concept.key)}><Trash2 size={14} /></button>}
            </div>;
          })}
        </div>;
      })}
    </section>

    {/* ─── 3 · La cascada ──────────────────────────────────────────────────── */}
    <section className="panel">
      <div className="panel-head"><h2 className="section-title"><Calculator size={17} /> La cascada</h2>
        <small>Los porcentajes se aplican en cascada: cada escalón toma el subtotal del anterior.</small></div>

      <div className="cascade-steps">
        <Step n="1" label="Costo directo" hint={`Materiales ${money(result.materialsCents)} · Mano de obra ${money(result.laborCents)} · Equipos ${money(result.equipmentCents)}`} value={result.directCostCents} />
        <Step n="2" label="+ Gastos generales directos" hint={`${cargados.length} conceptos`} value={result.ggdCents} />
        <Step n="3" label="= COSTO" value={result.costCents} sub />
        <Step n="4" label="+ Gastos generales indirectos" value={result.ggiCents}
          control={<Pct value={params.ggiPct} disabled={locked} onChange={value => edit(() => setParams({ ...params, ggiPct: value }))} />} />
        <Step n="5" label="= SUB TOTAL 1" value={result.subtotal1Cents} sub />
        <Step n="6" label="+ Beneficios" value={result.benefitCents}
          control={<Pct value={params.benefitPct} disabled={locked} onChange={value => edit(() => setParams({ ...params, benefitPct: value }))} />} />
        <Step n="" label="+ Costo financiero" value={result.financialCents}
          control={<Pct value={params.financialPct} disabled={locked} onChange={value => edit(() => setParams({ ...params, financialPct: value }))} />} />
        <Step n="7" label="= SUB TOTAL 2" value={result.subtotal2Cents} sub />
        <Step n="8" label="+ Ingresos brutos" value={result.iibbCents}
          control={<Pct value={params.iibbPct} disabled={locked} onChange={value => edit(() => setParams({ ...params, iibbPct: value }))} />} />
        <Step n="" label="= SUB TOTAL 3" value={result.subtotal3Cents} sub />
        <Step n="9" label="+ IVA" hint={`sobre ${params.ivaBase === "st3" ? "el subtotal 3, con ingresos brutos adentro" : "el subtotal 2, sin ingresos brutos"}`} value={result.ivaCents}
          control={<>
            <Pct value={params.ivaPct} disabled={locked} onChange={value => edit(() => setParams({ ...params, ivaPct: value }))} />
            <select value={params.ivaBase} disabled={locked} aria-label="Base del IVA"
              onChange={event => edit(() => setParams({ ...params, ivaBase: event.target.value as "st2" | "st3" }))}>
              <option value="st2">s/ ST2</option><option value="st3">s/ ST3</option>
            </select>
          </>} />
        <Step n="" label="= PRECIO" value={result.priceCents} final />
      </div>

      <div className="cascade-inverse">
        <Target size={16} />
        <div>
          <b>Fijar el precio y despejar el beneficio</b>
          <small>Es lo que hacen a mano con Goal Seek cuando el precio de venta tiene que ser un número redondo.</small>
        </div>
        <MoneyInput name="objetivo" defaultValue={targetCents / 100} disabled={locked} onValueChange={value => setTargetCents(Math.round(value * 100))} />
        <button className="secondary-btn" disabled={locked || !targetCents} onClick={() => despejarBeneficio(targetCents)}>Despejar</button>
      </div>
    </section>

    {/* ─── 4 · Precio ──────────────────────────────────────────────────────── */}
    <section className="panel">
      <div className="panel-head"><h2 className="section-title"><Wallet size={17} /> Precio al cliente</h2>
        <small>Cada ítem es su costo unitario por el coeficiente k. Es lo único de acá que ve el cliente.</small></div>

      <div className="table-scroll"><table><thead><tr>
        <th>Código</th><th>Ítem</th><th>Un.</th><th>Cantidad</th><th>Precio unitario</th><th>Importe</th><th>Fijar precio</th>
      </tr></thead><tbody>
        {result.items.map((item, index) => <tr key={index}>
          <td data-label="Código">{item.code || "—"}</td>
          <td data-label="Ítem"><b>{item.name || "Sin nombre"}</b></td>
          <td data-label="Unidad">{item.unit}</td>
          <td data-label="Cantidad">{formatQty(item.qty)}</td>
          <td data-label="Precio unitario" className="num">{preciseMoney(item.unitPriceCents)}</td>
          <td data-label="Importe" className="num"><strong>{money(item.priceCents)}</strong></td>
          <td data-label="Fijar precio" className="row-actions">
            {!locked && <button className="link-btn" onClick={() => {
              const tipeado = prompt(`Precio por ${item.unit} para “${item.name}”, con IVA:`, String(Math.round(item.unitPriceCents / 100)));
              if (tipeado === null) return;
              const objetivo = targetPriceFromUnitPrice(result, index, Math.round(Number(tipeado.replace(/\./g, "").replace(",", ".")) * 100));
              if (objetivo === null) { setError("Ese ítem no tiene costo cargado todavía"); return; }
              despejarBeneficio(objetivo);
            }}>fijar</button>}
          </td>
        </tr>)}
        <tr className="settlement-total">
          <td colSpan={5} data-label="Total"><b>Total de la cotización</b></td>
          <td className="num"><b>{money(result.priceCents)}</b></td><td />
        </tr>
      </tbody></table></div>

      <h3 className="cascade-subhead">Lista de compras y dotación</h3>
      <p className="cascade-note">Es el pedido a compras: la composición de todos los ítems agrupada por insumo. Mano de obra cargada: {formatQty(result.dotacion.horas)} horas ≈ {formatQty(result.dotacion.dias)} jornadas.</p>
      <div className="table-scroll"><table><thead><tr><th>Rubro</th><th>Insumo</th><th>Un.</th><th>Cantidad</th><th>Costo</th></tr></thead><tbody>
        {insumos.map(row => <tr key={`${row.rubro}-${row.name}-${row.unit}`}>
          <td data-label="Rubro">{rubroLabels[row.rubro]}</td>
          <td data-label="Insumo"><b>{row.name}</b></td>
          <td data-label="Unidad">{row.unit}</td>
          <td data-label="Cantidad">{formatQty(row.totalQty)}</td>
          <td data-label="Costo" className="num">{money(row.totalCostCents)}</td>
        </tr>)}
      </tbody></table></div>
      {!insumos.length && <div className="empty-state compact"><p>Cargá los insumos de los ítems y acá sale sola la lista de compras.</p></div>}
    </section>
  </>;
}

/** Un escalón de la cascada: número, concepto, el porcentaje si lo tiene, e importe. */
function Step({ n, label, hint, value, control, sub, final }: { n: string; label: string; hint?: string; value: number; control?: React.ReactNode; sub?: boolean; final?: boolean }) {
  return <div className={`cascade-step${sub ? " sub" : ""}${final ? " final" : ""}`}>
    <span className="cascade-step-n">{n}</span>
    <span className="cascade-step-label"><b>{label}</b>{hint && <small>{hint}</small>}</span>
    <span className="cascade-step-control">{control}</span>
    <output className="cascade-step-value">{money(value)}</output>
  </div>;
}

/** Un porcentaje: admite decimales porque el beneficio despejado los tiene. */
function Pct({ value, disabled, onChange }: { value: number; disabled?: boolean; onChange: (value: number) => void }) {
  return <label className="percent-input">
    <input inputMode="decimal" value={value} disabled={disabled} aria-label="Porcentaje"
      onChange={event => onChange(Number(String(event.target.value).replace(",", ".")) || 0)} />
    %
  </label>;
}

/* --- borrador ↔ modelo --------------------------------------------------- */

function nuevoInsumo(): DraftInsumo { return { rubro: "MAT", name: "", unit: "u", coefText: "", unitPriceCents: 0, currency: "ARS" }; }
function nuevoItem(): DraftItem { return { code: "", name: "", unit: "m2", qtyText: "", composition: [nuevoInsumo()] }; }

function toDraftItem(item: QuoteItem): DraftItem {
  return { ...item, qtyText: item.qty ? String(item.qty).replace(".", ",") : "", composition: (item.composition || []).map(toDraftInsumo) };
}
function toDraftInsumo(insumo: Insumo): DraftInsumo {
  return { ...insumo, coefText: insumo.coefPerUnit ? String(insumo.coefPerUnit).replace(".", ",") : "" };
}
function toDraftOverhead(line: OverheadLine): DraftOverhead {
  return { ...line, qtyText: line.qty ? String(line.qty).replace(".", ",") : "" };
}

function toItem(item: DraftItem): QuoteItem {
  return { code: item.code, name: item.name || "Sin nombre", unit: item.unit, qty: parseCoef(item.qtyText), composition: item.composition.map(toInsumo) };
}
function toInsumo(insumo: DraftInsumo): Insumo {
  const { coefText, ...rest } = insumo;
  return { ...rest, name: rest.name || "Sin nombre", coefPerUnit: parseCoef(coefText) };
}
function toLine(line: DraftOverhead): OverheadLine {
  const { qtyText, ...rest } = line;
  return { ...rest, qty: parseCoef(qtyText) };
}
