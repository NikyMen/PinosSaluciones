"use client";

import { useEffect, useState } from "react";
import { Plus, Tags, Trash2, X } from "lucide-react";
import { MoneyInput } from "@/components/fields";
import { unitLabels, WORK_TYPE_UNITS, type WorkTypeRow } from "@/lib/work-type-labels";

type Draft = Omit<WorkTypeRow, "_id"> & { _id?: string; key: string };

/**
 * La tabla de tipos de trabajo con su tarifa (la "CATEGORIA / HORA" de la
 * planilla). Cambiar una tarifa no toca lo ya cargado: vale para los partes nuevos.
 */
export function WorkTypesModal({ canEdit, onClose, onSaved }: { canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/work-types")
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudieron traer las tarifas"); return body.items as WorkTypeRow[]; })
      .then(items => setRows(items.map(item => ({ ...item, key: item._id }))))
      .catch(problem => { setRows([]); setError(problem instanceof Error ? problem.message : "No se pudieron traer las tarifas"); });
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const update = (key: string, patch: Partial<Draft>) => setRows(current => (current || []).map(row => row.key === key ? { ...row, ...patch } : row));

  async function save() {
    const items = (rows || []).filter(row => row.name.trim());
    setBusy(true); setError("");
    const response = await fetch("/api/work-types", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: items.map(row => ({ _id: row._id, name: row.name, unit: row.unit, rateCents: row.rateCents, active: row.active })) }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setError(result.error || "No se pudieron guardar las tarifas");
    onSaved();
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal work-types-modal" role="dialog" aria-modal="true" aria-labelledby="work-types-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Tags /></span><div>
        <p className="eyebrow">PERSONAL</p>
        <h2 id="work-types-title">Tarifas por tipo de trabajo</h2>
        <small>Lo que se paga por hora (o por unidad, m², metro) de cada tipo de trabajo. Un cambio vale para lo que se cargue de acá en adelante.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <div className="modal-form-body">
        {rows === null ? <div className="loading-state">Cargando…</div> : <>
          {!rows.length && <div className="empty-state compact"><p>Todavía no hay tarifas. Se cargan solas al importar la planilla de la quincena, o agregalas acá.</p></div>}
          {rows.length > 0 && <div className="table-scroll"><table className="work-types-table"><thead><tr><th>Tipo de trabajo</th><th>Se paga</th><th>Tarifa</th><th>Activo</th><th /></tr></thead><tbody>
            {rows.map(row => <tr key={row.key}>
              <td data-label="Tipo de trabajo"><input value={row.name} disabled={!canEdit} onChange={event => update(row.key, { name: event.target.value })} placeholder="Oficial, SILLETERO 1…" /></td>
              <td data-label="Se paga"><select value={row.unit} disabled={!canEdit} onChange={event => update(row.key, { unit: event.target.value as Draft["unit"] })}>
                {WORK_TYPE_UNITS.map(unit => <option key={unit} value={unit}>{unitLabels[unit].per}</option>)}
              </select></td>
              <td data-label="Tarifa"><MoneyInput name={`rate-${row.key}`} defaultValue={row.rateCents / 100} disabled={!canEdit} onValueChange={value => update(row.key, { rateCents: Math.round(value * 100) })} /></td>
              <td data-label="Activo"><input type="checkbox" checked={row.active} disabled={!canEdit} onChange={event => update(row.key, { active: event.target.checked })} aria-label={`${row.name} activo`} /></td>
              <td className="row-actions">{canEdit && !row._id && <button type="button" title="Sacar" onClick={() => setRows(current => (current || []).filter(candidate => candidate.key !== row.key))}><Trash2 size={15} /></button>}</td>
            </tr>)}
          </tbody></table></div>}
          {canEdit && <button type="button" className="secondary-btn work-types-add" onClick={() => setRows(current => [...(current || []), { key: `new-${Date.now()}`, name: "", unit: "hora", rateCents: 0, active: true }])}><Plus size={16} /> Agregar tipo de trabajo</button>}
        </>}
      </div>
      {error && <p className="form-error modal-error">{error}</p>}
      <footer><span>Los que ya no se usan se desactivan: no se borran para no perder lo cargado.</span><button type="button" className="secondary-btn" onClick={onClose}>Cerrar</button>{canEdit && <button type="button" className="primary-btn" disabled={busy || rows === null} onClick={() => { void save(); }}>{busy ? "Guardando…" : "Guardar tarifas"}</button>}</footer>
    </section>
  </div>;
}
