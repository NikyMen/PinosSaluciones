"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Entity } from "@/lib/constants";
import { entityConfig, type Field } from "@/lib/entity-config";
import { isoPlusDays, money, titleCase } from "@/lib/format";
import { DateInput, FileDrop, MoneyInput, PhoneList, SearchSelect, type Option } from "@/components/fields";

/*
 * El formulario genérico de un registro: un campo por cada entrada de
 * entity-config, y el alta rápida que lo usa. Lo comparten las tablas de cada
 * módulo y otras pantallas que dan de alta algo sin salir (el personal de una
 * obra, por ejemplo).
 */

export type RecordItem = Record<string, unknown> & { _id: string };

/** Traduce los errores por campo que devuelve zod a una frase legible. */
export function fieldErrors(result: { details?: { fieldErrors?: Record<string, string[]> } }) {
  const byField = result.details?.fieldErrors;
  if (!byField) return "";
  const messages = Object.values(byField).flat().filter(Boolean);
  return messages.length ? messages.join(". ") : "";
}

export type FieldProps = {
  field: Field;
  value: unknown;
  relationOptions: Option[];
  personOptions: Option[];
  relationValue: string;
  onRelationChange: (value: string) => void;
  onCreateRelation?: () => void;
};

/** Alta rápida de un registro relacionado (típicamente un cliente) sin salir del formulario. */
export function QuickCreateModal({ entity, onClose, onCreated, hint = "Se crea acá mismo y queda elegido en el formulario", submitLabel }: {
  entity: Entity; onClose: () => void; onCreated: (item: RecordItem) => void;
  /** La bajada del título: qué pasa con el registro después de crearlo. */ hint?: string; submitLabel?: string;
}) {
  const config = entityConfig[entity];
  // El alta rápida sólo pide campos simples: nada de relaciones anidadas ni archivos.
  const fields = config.fields.filter(field => field.type !== "relation" && field.type !== "file");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const form = new FormData(event.currentTarget); const body: Record<string, unknown> = {};
    for (const field of fields) {
      const value = form.get(field.key);
      body[field.key] = field.type === "money" ? Math.round(Number(value || 0) * 100) : field.type === "number" ? Number(value || 0) : value;
    }
    const response = await fetch(`/api/records/${entity}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setError(fieldErrors(result) || result.error || "No se pudo crear");
    onCreated(result as RecordItem);
  }

  return <div className="modal-layer quick-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal quick-modal" role="dialog" aria-modal="true" aria-labelledby="quick-modal-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Plus /></span><div><p className="eyebrow">ALTA RÁPIDA</p><h2 id="quick-modal-title">Nuevo {config.singular}</h2><small>{hint}</small></div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={submit}>
        <div className="modal-form-body"><div className="form-grid">{fields.map((field, index) => <FormField key={field.key} field={field} value={undefined} relationOptions={[]} personOptions={[]} relationValue="" onRelationChange={() => {}} autoFocus={index === 0} />)}</div></div>
        {error && <p className="form-error modal-error">{error}</p>}
        <footer><span>Después lo podés completar desde su módulo.</span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={saving}>{saving ? "Creando…" : submitLabel || `Crear ${config.singular}`}</button></footer>
      </form>
    </section>
  </div>;
}

export function FormField({ field, value, relationOptions, personOptions, relationValue, onRelationChange, onCreateRelation, autoFocus = false }: FieldProps & { autoFocus?: boolean }) {
  const label = <span>{field.label}{field.required && " *"}{field.hint && <em className="field-hint">{field.hint}</em>}</span>;
  const text = String(value ?? "");

  if (field.readOnly) return <label className="readonly-field">{label}<output>{field.type === "money" ? money(Number(value || 0)) : text || "—"}</output></label>;
  if (field.type === "money") return <label>{label}<MoneyInput name={field.key} defaultValue={Number(value || 0) / 100} required={field.required} autoFocus={autoFocus} /></label>;
  if (field.type === "date") return <label>{label}<DateInput name={field.key} required={field.required} autoFocus={autoFocus} quickRanges={field.quickRanges} hideToday={field.hideToday}
    defaultValue={value ? new Date(String(value)).toISOString().slice(0, 10) : field.defaultInDays ? isoPlusDays(field.defaultInDays) : ""} /></label>;
  if (field.type === "phones") return <label className="wide">{label}<PhoneList name={field.key} defaultValue={Array.isArray(value) ? value.map(String) : text ? [text] : []} /></label>;
  if (field.type === "file") return <label className="wide">{label}<FileDrop name={field.key} currentPath={text || undefined} /></label>;
  if (field.type === "textarea") return <label className="wide">{label}<textarea name={field.key} required={field.required} defaultValue={text} autoFocus={autoFocus} placeholder={field.placeholder} /></label>;
  // El estado que ya tiene el registro siempre se ofrece, aunque no sea de los
  // que se eligen a mano: si no, editar una cotización aprobada lo borraría.
  if (field.type === "select") {
    const options = [...(field.options || [])];
    if (text && !options.includes(text)) options.push(text);
    return <label>{label}<SearchSelect name={field.key} defaultValue={text || field.defaultValue || ""} required={field.required} autoFocus={autoFocus}
      options={options.map(option => ({ value: option, label: titleCase(option) }))} /></label>;
  }
  if (field.type === "user") return <label>{label}<SearchSelect name={field.key} options={personOptions} value={relationValue} onChange={onRelationChange}
    placeholder="Sin persona asignada" required={field.required} autoFocus={autoFocus} /></label>;
  if (field.type === "relation") return <label>{label}<SearchSelect name={field.key} options={relationOptions} value={relationValue} onChange={onRelationChange} required={field.required} autoFocus={autoFocus}
    createLabel={`Crear ${entityConfig[field.relation!].singular} nuevo`} onCreate={onCreateRelation} /></label>;

  return <label>{label}<input name={field.key} type={field.type === "number" ? "number" : field.type || "text"} required={field.required} defaultValue={text || field.defaultValue || ""} autoFocus={autoFocus}
    step={field.step ?? (field.key === "progress" ? "1" : undefined)} min={field.type === "number" ? "0" : undefined} placeholder={field.placeholder} /></label>;
}
