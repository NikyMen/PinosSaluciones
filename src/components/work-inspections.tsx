"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, ClipboardCheck, History, Plus, Ruler, Trash2, TriangleAlert, X } from "lucide-react";
import { MoneyInput } from "@/components/fields";
import { date, money, qty } from "@/lib/format";
import {
  INSPECTION_RUBROS, computeWorkProgress, inspectionTemplates, progressModeHints, rubroLabel,
  type InspectionAlert, type InspectionRubro, type LineProgress, type ProgressLine, type ProgressMode,
} from "@/lib/inspections";

type Summary = { overall: number | null; lines: LineProgress[]; byRubro: Partial<Record<InspectionRubro, number | null>>; weighting: "importe" | "igual" | null; mode: ProgressMode; progress: number };
type InspectionRow = { _id: string; dayKey: string; rubro: InspectionRubro; status: "borrador" | "cerrada"; managerName?: string; rubroProgressPct?: number | null; workProgressPct?: number | null; alerts?: InspectionAlert[]; closedByName?: string; createdByName?: string };
export type LegacyAdvance = { percentage: number; note: string; date: string };

/**
 * El centro de la obra para el avance físico: cuánto va (según inspecciones),
 * contra qué base se mide, el historial de inspecciones y los avances que se
 * cargaban a mano antes, que quedan como registro anterior.
 */
export function WorkInspections({ workId, canEdit, advances, onProgressChanged }: { workId: string; canEdit: boolean; advances: LegacyAdvance[]; onProgressChanged: () => void }) {
  const [items, setItems] = useState<InspectionRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [editingBase, setEditingBase] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/works/${workId}/inspections`);
    const result = await response.json();
    if (!response.ok) return setError(result.error || "No se pudieron cargar las inspecciones");
    setItems(result.items || []); setSummary(result.progress); setError("");
  }, [workId]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const closed = items.filter(item => item.status === "cerrada");
  const drafts = items.filter(item => item.status === "borrador");

  return <section id="inspecciones" className="panel work-inspections">
    <div className="panel-head">
      <div className="section-title"><ClipboardCheck /><div><h2>Inspecciones y avance físico</h2><p>El avance de la obra sale de la producción que informa cada inspección cerrada.</p></div></div>
      {canEdit && <Link className="primary-btn" href={`/app/works/${workId}/inspections/new`}><Plus size={17} /> Nueva inspección</Link>}
    </div>
    {error && <div className="notice error">{error}</div>}

    <div className="work-inspections-grid">
      <div className="progress-base">
        <div className="progress-base-head">
          <div>
            <span>Avance físico</span>
            <strong>{summary?.mode === "sin_base" ? "Sin base de avance" : `${summary?.progress ?? 0}%`}</strong>
            <small>{summary ? progressModeHints[summary.mode] : "Cargando…"}{summary?.weighting === "igual" ? " · líneas con el mismo peso (falta cargar algún importe)" : summary?.weighting === "importe" ? " · ponderado por importe contratado" : ""}</small>
          </div>
          {canEdit && <button type="button" className="secondary-btn" onClick={() => setEditingBase(true)}><Ruler size={16} /> {summary?.lines.length ? "Editar base" : "Cargar base de avance"}</button>}
        </div>
        {summary?.lines.length
          ? <div className="progress-lines">{summary.lines.map(line => <div className="progress-line" key={line._id}>
            <div><b>{line.label}</b><small>{rubroLabel(line.rubro)} · {qty(line.accumulatedQty)} de {qty(line.plannedQty)} {line.unit}{line.amountCents ? ` · ${money(line.amountCents)}` : ""}</small></div>
            {line.progressPct === null ? <em>Sin cantidad prevista</em> : <span className="insp-progress"><i style={{ width: `${line.progressPct}%` }} /><b>{line.progressPct}%</b></span>}
          </div>)}</div>
          : <div className="empty-state compact">Esta obra no tiene cantidades previstas. Sin base, las inspecciones registran la producción pero no calculan un porcentaje.{canEdit ? " Cargá la base (se puede traer de la cotización)." : ""}</div>}
      </div>

      <div className="inspection-history">
        <h3><History size={16} /> Historial de inspecciones</h3>
        {drafts.length > 0 && <div className="detail-list">{drafts.map(item => <InspectionLink key={item._id} workId={workId} item={item} />)}</div>}
        <div className="detail-list">{closed.map(item => <InspectionLink key={item._id} workId={workId} item={item} />)}</div>
        {!items.length && <div className="empty-state compact">Todavía no hay inspecciones.</div>}
        {advances.length > 0 && <details className="legacy-advances">
          <summary>Avances cargados a mano antes de las inspecciones ({advances.length})</summary>
          <div className="detail-list">{advances.slice().reverse().map((item, index) => <div className="detail-row" key={index}><b>{item.percentage}%</b><span>{item.note}</span><small>{date(item.date)}</small></div>)}</div>
        </details>}
      </div>
    </div>

    {editingBase && <ProgressBaseModal workId={workId} current={summary} onClose={() => setEditingBase(false)} onSaved={() => { setEditingBase(false); void load(); onProgressChanged(); }} />}
  </section>;
}

function InspectionLink({ workId, item }: { workId: string; item: InspectionRow }) {
  const alerts = item.alerts?.length || 0;
  return <Link className="detail-row insp-history-row" href={`/app/works/${workId}/inspections/${item._id}`}>
    <b>{date(item.dayKey)}</b>
    <span>{rubroLabel(item.rubro)}{item.managerName ? ` · ${item.managerName}` : ""}</span>
    {item.status === "borrador"
      ? <span className="badge pendiente">Borrador</span>
      : <>
        {alerts > 0 ? <em className="insp-alert-count" title={item.alerts?.map(alert => alert.message).join("\n")}><TriangleAlert size={13} /> {alerts}</em> : <em className="insp-alert-count ok">Sin alertas</em>}
        <strong>{item.rubroProgressPct === null || item.rubroProgressPct === undefined ? "Sin base" : `${item.rubroProgressPct}%`}</strong>
      </>}
    <ChevronRight size={15} />
  </Link>;
}

/* ─── Base de avance ───────────────────────────────────────────────────────── */

type EditableLine = ProgressLine & { key: string; isNew?: boolean };
type QuoteItem = { code: string; name: string; unit: string; qty: number; priceCents: number; rubro: InspectionRubro };

let tempKey = 0;
const nextKey = () => `new-${++tempKey}`;

/**
 * La base del avance: por cada rubro (o ítem) lo contratado en cantidades y en
 * pesos. El importe es el peso en el avance general. "Ya ejecutado" es para las
 * obras que arrancaron antes de usar inspecciones: lo hecho no vuelve a cero.
 */
function ProgressBaseModal({ workId, current, onClose, onSaved }: { workId: string; current: Summary | null; onClose: () => void; onSaved: () => void }) {
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([]);
  const [legacy, setLegacy] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch(`/api/works/${workId}/progress-base`).then(async response => {
      const result = await response.json();
      setLoading(false);
      if (!response.ok) return setError(result.error || "No se pudo cargar la base");
      setLines((result.lines || []).map((line: ProgressLine) => ({ ...line, _id: String(line._id), key: String(line._id), initialQty: Number(line.initialQty) || 0 })));
      setQuoteItems(result.quoteItems || []);
      setLegacy(result.legacyProgress);
    }).catch(() => { setLoading(false); setError("No se pudo cargar la base"); });
  }, [workId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Lo producido por inspecciones cerradas no cambia al editar la base: se reusa para la vista previa.
  const closedByLine = useMemo(() => Object.fromEntries((current?.lines || []).map(line => [line._id, line.accumulatedQty - (Number(line.initialQty) || 0)])), [current]);
  const preview = computeWorkProgress(lines.map(line => ({ ...line, _id: line.key })), Object.fromEntries(lines.map(line => [line.key, closedByLine[line._id] || 0])));

  const set = (key: string, patch: Partial<EditableLine>) => setLines(rows => rows.map(row => row.key === key ? { ...row, ...patch } : row));
  const add = (line?: Partial<EditableLine>) => setLines(rows => [...rows, { _id: "", key: nextKey(), isNew: true, rubro: "albanileria", label: "", unit: "m2", plannedQty: 0, initialQty: 0, amountCents: 0, ...line }]);

  function importQuote() {
    const existing = new Set(lines.map(line => line.label.trim().toLowerCase()));
    const fresh = quoteItems.filter(item => !existing.has(item.name.trim().toLowerCase()));
    if (!fresh.length) return setError("Todos los ítems de la cotización ya están en la base.");
    setError("");
    setLines(rows => [...rows, ...fresh.map(item => ({
      _id: "", key: nextKey(), isNew: true, rubro: item.rubro, label: item.name, unit: item.unit || "m2", plannedQty: item.qty, amountCents: item.priceCents,
      initialQty: legacy ? Math.round(item.qty * legacy) / 100 : 0,
    }))]);
  }

  async function save() {
    const invalid = lines.find(line => !line.label.trim());
    if (invalid) return setError("Cada línea necesita una descripción.");
    const over = lines.find(line => (line.initialQty || 0) > line.plannedQty && line.plannedQty > 0);
    if (over) return setError(`“${over.label}”: lo ya ejecutado no puede superar la cantidad prevista.`);
    setSaving(true); setError("");
    const response = await fetch(`/api/works/${workId}/progress-base`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines: lines.map(line => ({ _id: line.isNew ? "" : line._id, rubro: line.rubro, label: line.label.trim(), unit: line.unit, plannedQty: line.plannedQty, initialQty: line.initialQty || 0, amountCents: line.amountCents })) }),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setError(result.error || "No se pudo guardar la base");
    onSaved();
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal progress-base-modal" role="dialog" aria-modal="true" aria-labelledby="progress-base-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Ruler /></span><div>
        <p className="eyebrow">BASE DE AVANCE</p><h2 id="progress-base-title">Cantidades previstas</h2>
        <small>Contra esto se mide la producción de las inspecciones. El importe es el peso de cada línea en el avance general.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="modal-form-body progress-base-body">
        {legacy !== null && <p className="convert-warning"><TriangleAlert size={17} /><span>Esta obra tenía <b>{legacy}%</b> de avance cargado a mano. Completá “Ya ejecutado” para que el avance no vuelva a cero al pasar a inspecciones.{lines.length > 0 && <> <button type="button" className="link-btn" onClick={() => setLines(rows => rows.map(row => ({ ...row, initialQty: Math.round(row.plannedQty * legacy) / 100 })))}>Aplicar {legacy}% a todas las líneas</button></>}</span></p>}
        {loading ? <div className="loading-state">Cargando…</div> : <>
          <div className="base-table">
            <div className="base-table-head"><span>Rubro</span><span>Descripción</span><span>Unidad</span><span>Cantidad prevista</span><span>Ya ejecutado</span><span>Importe contratado</span><span /></div>
            {lines.map(line => <div className="base-table-row" key={line.key}>
              <label data-label="Rubro"><select value={line.rubro} onChange={event => set(line.key, { rubro: event.target.value as InspectionRubro })}>{INSPECTION_RUBROS.map(rubro => <option key={rubro} value={rubro}>{inspectionTemplates[rubro].label}</option>)}</select></label>
              <label data-label="Descripción"><input value={line.label} maxLength={160} onChange={event => set(line.key, { label: event.target.value })} placeholder="Ej.: Pintura de fachada" /></label>
              <label data-label="Unidad"><input value={line.unit} maxLength={20} onChange={event => set(line.key, { unit: event.target.value })} /></label>
              <label data-label="Prevista"><input type="number" min="0" step="any" value={line.plannedQty || ""} onChange={event => set(line.key, { plannedQty: Number(event.target.value) || 0 })} /></label>
              <label data-label="Ya ejecutado"><input type="number" min="0" step="any" value={line.initialQty || ""} onChange={event => set(line.key, { initialQty: Number(event.target.value) || 0 })} /></label>
              <label data-label="Importe"><MoneyInput name={`amount-${line.key}`} defaultValue={line.amountCents / 100} onValueChange={value => set(line.key, { amountCents: Math.round(value * 100) })} /></label>
              <span><button type="button" className="check-delete" aria-label={`Quitar ${line.label}`} onClick={() => setLines(rows => rows.filter(row => row.key !== line.key))}><Trash2 /></button></span>
            </div>)}
            {!lines.length && <p className="insp-empty">Sin líneas. Agregá una o traé los ítems de la cotización.</p>}
          </div>
          <div className="base-actions">
            <button type="button" className="secondary-btn" onClick={() => add()}><Plus size={15} /> Agregar línea</button>
            {quoteItems.length > 0 && <button type="button" className="secondary-btn" onClick={importQuote}><ClipboardCheck size={15} /> Traer {quoteItems.length} ítem(s) de la cotización</button>}
            <span className="base-preview">Avance con esta base: <b>{preview.overall === null ? "sin base" : `${preview.overall}%`}</b>{preview.weighting === "igual" ? " (líneas con igual peso)" : ""}</span>
          </div>
        </>}
      </div>
      {error && <p className="form-error modal-error">{error}</p>}
      <footer><span>Una línea con producción ya informada no se puede quitar. Queda auditado.</span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={saving || loading}>{saving ? "Guardando…" : "Guardar base"}</button></footer>
      </form>
    </section>
  </div>;
}

