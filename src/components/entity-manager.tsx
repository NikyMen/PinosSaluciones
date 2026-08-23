"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BriefcaseBusiness, CalendarDays, Download, Edit3, Eye, HardHat, ListTodo, Plus, Search, Trash2, Upload, UserRound, X } from "lucide-react";
import Link from "next/link";
import type { Entity } from "@/lib/constants";
import { entityConfig, columnLabels, type Field } from "@/lib/entity-config";
import { date, dateTime, money, titleCase } from "@/lib/format";

type Item = Record<string, unknown> & { _id: string };
type AuditEntry = { _id: string; action: string; userName?: string; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; createdAt?: string };

export function EntityManager({ entity, canEdit, canDeleteRecords }: { entity: Entity; canEdit: boolean; canDeleteRecords: boolean }) {
  const config = entityConfig[entity];
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [relations, setRelations] = useState<Record<string, Item[]>>({});
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/records/${entity}?limit=100&search=${encodeURIComponent(search)}`);
    const result = await response.json();
    if (response.ok) { setItems(result.items); setError(""); }
    else setError(result.error || "No se pudieron cargar los registros");
    setLoading(false);
  }, [entity, search]);

  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [load]);
  const relationEntities = useMemo(() => [...new Set(config.fields.filter(field => field.relation).map(field => field.relation!))], [config.fields]);
  useEffect(() => {
    Promise.all(relationEntities.map(async relation => {
      const response = await fetch(`/api/records/${relation}?limit=100`);
      const result = await response.json();
      return [relation, response.ok ? result.items || [] : []] as const;
    })).then(values => setRelations(Object.fromEntries(values)));
  }, [relationEntities]);

  useEffect(() => {
    if (!modal) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setModal(false); };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previous; };
  }, [modal]);

  function relationLabel(field: string, value: unknown) {
    const definition = config.fields.find(candidate => candidate.key === field);
    const row = definition?.relation ? relations[definition.relation]?.find(candidate => candidate._id === String(value)) : null;
    return row ? String(row.name || row.title || row.number) : value ? "…" : "—";
  }

  function display(key: string, value: unknown) {
    if (key.endsWith("Cents")) return money(Number(value || 0));
    if (key === "progress") return `${value || 0}%`;
    if (key.toLowerCase().includes("date")) return date(value as string);
    if (key.endsWith("Id")) return relationLabel(key, value);
    if (key === "status" || key === "type" || key === "method" || key === "direction" || key === "assigneeRole") return <span className={`badge ${value}`}>{titleCase(String(value || ""))}</span>;
    return value ? String(value) : "—";
  }

  function open(item?: Item) {
    if (!canEdit) return;
    setEditing(item || null);
    setModal(true);
    setError("");
  }

  async function remove(item: Item) {
    if (!confirm(`¿Eliminar este ${config.singular}? Esta acción quedará auditada.`)) return;
    const response = await fetch(`/api/records/${entity}/${item._id}`, { method: "DELETE" });
    if (response.ok) void load(); else setError((await response.json()).error);
  }

  async function updateStatus(item: Item, status: string) {
    const previous = item.status;
    setStatusBusy(item._id);
    setItems(current => current.map(row => row._id === item._id ? { ...row, status } : row));
    const response = await fetch(`/api/records/${entity}/${item._id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    const result = await response.json();
    if (!response.ok) {
      setItems(current => current.map(row => row._id === item._id ? { ...row, status: previous } : row));
      setError(result.error || "No se pudo cambiar el estado");
    } else setItems(current => current.map(row => row._id === item._id ? { ...row, ...result } : row));
    setStatusBusy("");
  }

  async function convertQuote(item: Item) {
    if (!confirm(`Estás por convertir la cotización ${String(item.number || "")} en una obra.\n\nLa cotización va a salir del listado activo y no se va a poder volver a convertir. Queda registrado que la convertiste vos.\n\n¿Estás de acuerdo?`)) return;
    const code = prompt("Código para la nueva obra:", `OB-${String(item.number || "")}`); if (!code) return;
    const name = prompt("Nombre de la obra:", String(item.title || "")); if (!name) return;
    const response = await fetch(`/api/quotes/${item._id}/convert`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
    const result = await response.json(); if (!response.ok) setError(result.error); else void load();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaving(true);
    const form = new FormData(event.currentTarget); const body: Record<string, unknown> = {};
    for (const field of config.fields) {
      let value: unknown = form.get(field.key);
      if (field.type === "file") {
        if (value instanceof File && value.size) {
          const upload = new FormData(); upload.set("file", value);
          const response = await fetch("/api/uploads", { method: "POST", body: upload }); const result = await response.json();
          if (!response.ok) { setSaving(false); return setError(result.error || "No se pudo subir el archivo"); }
          value = result.path;
        } else value = editing?.[field.key] || "";
      } else if (field.type === "money") value = Math.round(Number(value || 0) * 100);
      else if (field.type === "number") value = Number(value || 0);
      body[field.key] = value;
    }
    const url = editing ? `/api/records/${entity}/${editing._id}` : `/api/records/${entity}`;
    const response = await fetch(url, { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { setSaving(false); return setError(result.error || "No se pudo guardar"); }
    setSaving(false); setModal(false); void load();
  }

  async function importFile(file?: File) {
    if (!file) return; setLoading(true); setError(""); const form = new FormData(); form.set("file", file);
    const response = await fetch(`/api/import/${entity}`, { method: "POST", body: form }); const result = await response.json();
    if (!response.ok) setError(result.error); else if (result.errors?.length) setError(`Se importaron ${result.imported} de ${result.total} filas. ${result.errors.length} tuvieron errores.`);
    await load(); if (fileRef.current) fileRef.current.value = "";
  }

  const statusOptions = config.fields.find(field => field.key === "status")?.options || [];

  return <>
    <div className="page-heading"><div><p className="eyebrow">GESTIÓN</p><h1>{config.title}</h1><p>{config.description}</p></div>{canEdit && <button className="primary-btn" onClick={() => open()}><Plus size={18} /> Nuevo {config.singular}</button>}</div>
    <div className="toolbar"><div className="search"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={`Buscar en ${config.title.toLowerCase()}…`} /></div>{canEdit && <><input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={event => { void importFile(event.target.files?.[0]); }} /><button className="secondary-btn" onClick={() => fileRef.current?.click()}><Upload size={17} /> Importar</button></>}<a className="secondary-btn" href={`/api/reports/export?entity=${entity}`}><Download size={17} /> Exportar CSV</a></div>
    {error && <div className="notice error">{error}</div>}
    <section className="table-panel"><div className="table-scroll"><table><thead><tr>{config.columns.map(column => <th key={column}>{columnLabels[column] || column}</th>)}<th /></tr></thead><tbody>{items.map(item => {
      const rowEditable = (entity === "works" || entity === "tasks") && canEdit;
      return <tr key={item._id} className={rowEditable ? "clickable-row" : ""} onClick={rowEditable ? () => open(item) : undefined} onKeyDown={rowEditable ? event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(item); } } : undefined} tabIndex={rowEditable ? 0 : undefined} title={rowEditable ? (entity === "tasks" ? "Abrir detalle de la tarea" : "Seleccionar para editar") : undefined}>
        {config.columns.map(column => <td key={column}>{(entity === "works" || entity === "tasks") && column === "status" && canEdit ? <select className={`inline-status ${item.status}`} value={String(item.status || "")} disabled={statusBusy === item._id} onClick={event => event.stopPropagation()} onChange={event => { event.stopPropagation(); void updateStatus(item, event.target.value); }} aria-label={`Estado de ${String(item.name || item.title || "la tarea")}`}>{statusOptions.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}</select> : display(column, item[column])}</td>)}
        <td className="row-actions" onClick={event => event.stopPropagation()}>{entity === "works" && <Link title="Abrir obra" href={`/app/works/${item._id}`}><Eye size={16} /></Link>}{entity === "quotes" && canEdit && item.status === "aprobada" && <button title="Convertir en obra" onClick={() => { void convertQuote(item); }}><BriefcaseBusiness size={16} /></button>}{canEdit && <button title={entity === "tasks" ? "Ver y editar tarea" : "Editar"} onClick={() => open(item)}><Edit3 size={16} /></button>}{canDeleteRecords && <button title="Eliminar" onClick={() => { void remove(item); }}><Trash2 size={16} /></button>}</td>
      </tr>;
    })}</tbody></table></div>{loading ? <div className="loading-state">Cargando…</div> : !items.length && <div className="empty-state compact"><p>No hay registros para mostrar.</p>{canEdit && <button onClick={() => open()}>Crear {config.singular}</button>}</div>}</section>
    {modal && entity === "tasks" && <TaskModal task={editing} config={config} relations={relations} error={error} saving={saving} onClose={() => setModal(false)} onSubmit={submit} />}
    {modal && entity !== "tasks" && <div className="modal-layer"><button className="modal-backdrop" onClick={() => setModal(false)} aria-label="Cerrar" /><section className={`modal entity-modal ${entity === "works" ? "work-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="entity-modal-title"><header><div className="modal-title-wrap"><span className="modal-heading-icon">{entity === "works" ? <HardHat /> : <Edit3 />}</span><div><p className="eyebrow">{editing ? "EDITAR REGISTRO" : "NUEVO REGISTRO"}</p><h2 id="entity-modal-title">{editing ? `Editar ${config.singular}` : `Nuevo ${config.singular}`}</h2><small>{entity === "works" ? "Información general, planificación y control de la obra" : `Completá los datos del ${config.singular}`}</small></div></div><button className="icon-btn" onClick={() => setModal(false)} aria-label="Cerrar"><X /></button></header><form onSubmit={submit}><div className="modal-form-body">{entity === "works" ? <WorkFields fields={config.fields} editing={editing} relations={relations} /> : <div className="form-grid">{config.fields.map((field, index) => <FormField key={field.key} field={field} value={editing?.[field.key]} relationItems={field.relation ? relations[field.relation] || [] : []} autoFocus={index === 0} />)}</div>}</div>{error && <p className="form-error modal-error">{error}</p>}<footer><span>Los cambios quedan registrados automáticamente.</span><button type="button" className="secondary-btn" onClick={() => setModal(false)}>Cancelar</button><button className="primary-btn" disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</button></footer></form></section></div>}
  </>;
}

const workGroups = [
  { title: "Identificación", description: "Datos principales de la obra", keys: ["code", "name", "clientId", "quoteId"] },
  { title: "Planificación", description: "Fechas, estado y avance", keys: ["startDate", "endDate", "status", "progress"] },
  { title: "Control económico", description: "Presupuesto y centro de costo", keys: ["budgetCents", "costCenter"] },
];

function WorkFields({ fields, editing, relations }: { fields: Field[]; editing: Item | null; relations: Record<string, Item[]> }) {
  return <div className="work-form-sections">{workGroups.map((group, groupIndex) => <fieldset key={group.title}><legend><b>{group.title}</b><small>{group.description}</small></legend><div className="form-grid">{group.keys.map((key, index) => { const field = fields.find(candidate => candidate.key === key); return field ? <FormField key={field.key} field={field} value={editing?.[field.key]} relationItems={field.relation ? relations[field.relation] || [] : []} autoFocus={groupIndex === 0 && index === 0} /> : null; })}</div></fieldset>)}</div>;
}

function TaskModal({ task, config, relations, error, saving, onClose, onSubmit }: { task: Item | null; config: typeof entityConfig["tasks"]; relations: Record<string, Item[]>; error: string; saving: boolean; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const status = String(task?.status || "pendiente");
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" /><section className="modal entity-modal task-modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title">
    <header><div className="modal-title-wrap"><span className="modal-heading-icon"><ListTodo /></span><div><p className="eyebrow">{task ? "DETALLE DE TAREA" : "NUEVA TAREA"}</p><h2 id="task-modal-title">{task ? String(task.title || "Tarea") : "Nueva tarea"}</h2><small>Seguimiento operativo con trazabilidad de cada modificación</small></div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
    {task && <div className="task-summary"><div className="task-summary-icon"><ListTodo size={21} /></div><div><span>Estado actual</span><strong className={`badge ${status}`}>{titleCase(status)}</strong></div><div><span>Vencimiento</span><strong><CalendarDays size={14} />{date(task.dueDate as string)}</strong></div><div><span>Responsable</span><strong><UserRound size={14} />{task.assigneeRole ? titleCase(String(task.assigneeRole)) : "Sin asignar"}</strong></div></div>}
    <form onSubmit={onSubmit}><div className="modal-form-body"><div className="task-form-heading"><div><p className="eyebrow">INFORMACIÓN</p><h3>Datos de la tarea</h3></div><span>Los cambios quedan registrados automáticamente.</span></div><div className="form-grid">{config.fields.map((field, index) => <FormField key={field.key} field={field} value={task?.[field.key]} relationItems={field.relation ? relations[field.relation] || [] : []} autoFocus={index === 0} />)}</div></div>{error && <p className="form-error modal-error">{error}</p>}<footer><span>Usuario, fecha y hora se guardan en cada cambio.</span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</button></footer></form>
    {task && <TaskHistory taskId={task._id} />}
  </section></div>;
}

function TaskHistory({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/audit?entity=tasks&entityId=${encodeURIComponent(taskId)}`, { signal: controller.signal }).then(async response => {
      const result = await response.json() as { items?: AuditEntry[]; error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo cargar el historial");
      return result.items || [];
    }).then(setItems).catch(loadError => {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el historial");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [taskId]);

  return <section className="task-history"><div className="task-form-heading"><div><p className="eyebrow">TRAZABILIDAD</p><h3>Historial de cambios</h3></div><span>Usuario · fecha y hora</span></div>{loading ? <p className="task-history-state">Cargando historial…</p> : error ? <p className="task-history-state error-text">{error}</p> : !items.length ? <p className="task-history-state">Todavía no hay movimientos registrados.</p> : <ol>{items.map(item => <li key={item._id}><span className="task-history-marker" /><div><strong>{auditSummary(item)}</strong><small>{item.userName || "Usuario"} · {dateTime(item.createdAt)}</small></div></li>)}</ol>}</section>;
}

function auditSummary(entry: AuditEntry) {
  const before = entry.before; const after = entry.after;
  if (!before && after) return "Tarea creada";
  if (before && after && before.status !== after.status) return `Estado: ${titleCase(String(before.status || ""))} → ${titleCase(String(after.status || ""))}`;
  if (!after) return "Tarea eliminada";
  const ignored = new Set(["_id", "__v", "createdAt", "updatedAt"]);
  const changed = Object.keys(after).filter(key => !ignored.has(key) && JSON.stringify(before?.[key]) !== JSON.stringify(after[key]));
  return changed.length ? `Actualizó ${changed.slice(0, 3).map(auditFieldLabel).join(", ")}` : "Datos actualizados";
}

function auditFieldLabel(field: string) {
  const labels: Record<string, string> = { title: "título", description: "descripción", type: "tipo", dueDate: "vencimiento", assigneeRole: "responsable" };
  return labels[field] || field;
}

function FormField({ field, value, relationItems, autoFocus = false }: { field: Field; value: unknown; relationItems: Item[]; autoFocus?: boolean }) {
  const common = { name: field.key, required: field.required, defaultValue: field.type === "money" ? Number(value || 0) / 100 : field.type === "date" && value ? new Date(String(value)).toISOString().slice(0, 10) : String(value ?? ""), autoFocus };
  return <label className={field.type === "textarea" ? "wide" : ""}><span>{field.label}{field.required && " *"}</span>{field.type === "textarea" ? <textarea {...common} /> : field.type === "select" ? <select {...common}><option value="">Seleccionar…</option>{field.options?.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}</select> : field.type === "relation" ? <select {...common}><option value="">Seleccionar…</option>{relationItems.map(item => <option key={item._id} value={item._id}>{String(item.name || item.title || item.number)}</option>)}</select> : field.type === "file" ? <><input name={field.key} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx" autoFocus={autoFocus} />{value && <a href={String(value)} target="_blank" rel="noreferrer">Ver archivo actual</a>}</> : <input {...common} type={field.type === "money" || field.type === "number" ? "number" : field.type || "text"} step={field.type === "money" ? "0.01" : field.key === "progress" ? "1" : undefined} min={field.type === "money" || field.type === "number" ? "0" : undefined} placeholder={field.placeholder} />}</label>;
}
