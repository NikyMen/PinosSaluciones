"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, BriefcaseBusiness, CalendarDays, Check, CheckCircle2, Download, Edit3, Eye, FileCheck2, HardHat, History, ListTodo, Percent, Plus, Search, TriangleAlert, Trash2, Upload, UserRound, Users, X } from "lucide-react";
import Link from "next/link";
import { ROLES, roleLabels, type Entity, type Role } from "@/lib/constants";
import { entityConfig, columnLabels, type Field } from "@/lib/entity-config";
import { date, isoPlusDays, money, titleCase } from "@/lib/format";
import { DateInput, FileDrop, MoneyInput, PhoneList, SearchSelect, type Option } from "@/components/fields";
import { HistoryModal, RecordHistory } from "@/components/record-history";
import { StockMovementModal, type StockItem } from "@/components/stock-movement";
import { InvoiceWorkModal, currentPeriod, type InvoiceableWork } from "@/components/work-invoice";
import { buildInvoicePdf, readBrandLogo } from "@/lib/invoice-pdf";

type Item = Record<string, unknown> & { _id: string };

// Modulos donde la fila entera abre el formulario.
const inlineEntities = new Set<Entity>(["works", "tasks", "quotes", "purchases"]);
// Donde ademas el estado se cambia sin entrar. En cotizaciones no: ahi el
// estado lo mueve el formulario y "aprobada" solo sale del boton Aprobar.
const inlineStatusEntities = new Set<Entity>(["works", "tasks", "purchases"]);

// Estados desde los que todavia tiene sentido aprobar una cotizacion.
const approvable = new Set(["borrador", "enviada", "seguimiento", "vencida"]);

/** Etiqueta corta de un registro, para títulos y para el buscador de los selects. */
function itemLabel(item: Item) {
  return String(item.name || item.title || item.number || item.code || item.description || "Registro");
}

export type Viewer = { userId: string; role: Role };

/** Quién de la empresa puede aparecer como responsable de una tarea. */
type Person = { _id: string; name: string; role: Role };

export function EntityManager({ entity, canEdit, canDeleteRecords, viewer }: { entity: Entity; canEdit: boolean; canDeleteRecords: boolean; viewer: Viewer }) {
  const config = entityConfig[entity];
  const isAdmin = viewer.role === "gerencia";
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
  // Valor elegido en cada select de relación, para poder cambiarlo desde el alta rápida.
  const [relationValues, setRelationValues] = useState<Record<string, string>>({});
  const [quickCreate, setQuickCreate] = useState<{ fieldKey: string; entity: Entity } | null>(null);
  const [historyFor, setHistoryFor] = useState<{ _id: string; label: string } | null>(null);
  const [movementFor, setMovementFor] = useState<{ item: StockItem; kind: "ingreso" | "egreso" } | null>(null);
  const [convertFor, setConvertFor] = useState<Item | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<Item | null>(null);
  // Estado elegido en una fila que todavía espera el visto bueno.
  const [pendingStatus, setPendingStatus] = useState<{ id: string; status: string } | null>(null);
  // Filtros de Tareas: el atajo elegido y, para gerencia, área y persona.
  const [taskScope, setTaskScope] = useState<"" | "mine" | "area">("");
  const [taskRole, setTaskRole] = useState("");
  const [taskPerson, setTaskPerson] = useState("");
  const [people, setPeople] = useState<Person[]>([]);

  const taskQuery = useMemo(() => {
    if (entity !== "tasks") return "";
    const params = new URLSearchParams();
    if (taskScope) params.set("scope", taskScope);
    if (isAdmin && taskRole) params.set("assigneeRole", taskRole);
    if (isAdmin && taskPerson) params.set("assigneeId", taskPerson);
    return params.toString();
  }, [entity, taskScope, taskRole, taskPerson, isAdmin]);

  const load = useCallback(async () => {
    // Al recargar, un cambio de estado a medio confirmar no queda colgado.
    setPendingStatus(null);
    setLoading(true);
    const response = await fetch(`/api/records/${entity}?limit=100&search=${encodeURIComponent(search)}${taskQuery ? `&${taskQuery}` : ""}`);
    const result = await response.json();
    if (response.ok) { setItems(result.items); setError(""); }
    else setError(result.error || "No se pudieron cargar los registros");
    setLoading(false);
  }, [entity, search, taskQuery]);

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
    if (entity !== "tasks") return;
    void fetch("/api/users/directory")
      .then(response => response.ok ? response.json() as Promise<{ items?: Person[] }> : { items: [] })
      .then(result => setPeople(result.items || []))
      .catch(() => setPeople([]));
  }, [entity]);

  useEffect(() => {
    if (!modal) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !quickCreate) setModal(false); };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previous; };
  }, [modal, quickCreate]);

  function relationLabel(field: string, value: unknown) {
    const definition = config.fields.find(candidate => candidate.key === field);
    const row = definition?.relation ? relations[definition.relation]?.find(candidate => candidate._id === String(value)) : null;
    return row ? itemLabel(row) : value ? "…" : "—";
  }

  function display(key: string, value: unknown) {
    if (key.endsWith("Cents")) return money(Number(value || 0));
    if (key === "progress") return `${value || 0}%`;
    if (key === "phones") return Array.isArray(value) && value.length ? value.join(" · ") : "—";
    if (key === "minQuantity") return Number(value || 0) || "—";
    if (key.toLowerCase().includes("date") || key === "validUntil") return date(value as string);
    if (key.endsWith("Id")) return relationLabel(key, value);
    if (key === "status" || key === "type" || key === "method" || key === "direction" || key === "assigneeRole") return <span className={`badge ${value}`}>{titleCase(String(value || ""))}</span>;
    return value ? String(value) : "—";
  }

  function open(item?: Item) {
    if (!canEdit) return;
    setEditing(item || null);
    setRelationValues(Object.fromEntries(config.fields.filter(field => field.relation || field.type === "user").map(field => [field.key, String(item?.[field.key] ?? "")])));
    setModal(true);
    setError("");
  }

  async function remove(item: Item) {
    if (!confirm(`¿Eliminar este ${config.singular}? Esta acción quedará auditada.`)) return;
    const response = await fetch(`/api/records/${entity}/${item._id}`, { method: "DELETE" });
    if (response.ok) void load(); else setError((await response.json()).error);
  }

  /**
   * Cambiar un estado desde el listado no se aplica de una: el select deja el
   * valor nuevo a la vista y al lado aparece el visto para confirmarlo. Un
   * `confirm()` del navegador se contesta que sí sin leerlo; esto obliga a
   * mirar a qué estado va antes de que quede guardado.
   */
  function askStatus(item: Item, status: string) {
    if (status === String(item.status || "")) return setPendingStatus(null);
    setPendingStatus({ id: item._id, status });
  }

  /** Devuelve el registro ya guardado, o `null` si el cambio no entró. */
  async function updateStatus(item: Item, status: string) {
    setPendingStatus(null);
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
    return response.ok ? { ...item, ...result } as Item : null;
  }

  /**
   * Aprobar una cotización y, sin soltar el hilo, ofrecer pasarla a obra: el
   * pop-up sale solo con los datos a la vista. Ahí se decide si además se
   * factura un porcentaje del trabajo.
   */
  async function approveQuote(item: Item) {
    const approved = await updateStatus(item, "aprobada");
    if (approved) setConvertFor(approved);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaving(true);
    const form = new FormData(event.currentTarget); const body: Record<string, unknown> = {};
    for (const field of config.fields) {
      if (field.readOnly) continue;
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
    if (!response.ok) { setSaving(false); return setError(fieldErrors(result) || result.error || "No se pudo guardar"); }
    setSaving(false); setModal(false); void load();
  }

  async function importFile(file?: File) {
    if (!file) return; setLoading(true); setError(""); const form = new FormData(); form.set("file", file);
    const response = await fetch(`/api/import/${entity}`, { method: "POST", body: form }); const result = await response.json();
    if (!response.ok) setError(result.error); else if (result.errors?.length) setError(`Se importaron ${result.imported} de ${result.total} filas. ${result.errors.length} tuvieron errores.`);
    await load(); if (fileRef.current) fileRef.current.value = "";
  }

  const statusOptions = config.fields.find(field => field.key === "status")?.options || [];

  /** Props comunes que necesita cada campo del formulario. */
  const fieldProps = (field: Field) => ({
    field,
    value: editing?.[field.key],
    relationOptions: field.relation ? (relations[field.relation] || []).map(item => ({ value: item._id, label: itemLabel(item), hint: String(item.cuit || item.email || "") || undefined })) : [],
    relationValue: relationValues[field.key] ?? "",
    personOptions: field.type === "user" ? people.map(person => ({ value: person._id, label: person.name, hint: roleLabels[person.role] })) : [],
    onRelationChange: (value: string) => setRelationValues(current => ({ ...current, [field.key]: value })),
    onCreateRelation: field.relation ? () => setQuickCreate({ fieldKey: field.key, entity: field.relation! }) : undefined,
  });

  return <>
    <div className="page-heading"><div><p className="eyebrow">GESTIÓN</p><h1>{config.title}</h1><p>{config.description}</p></div>{canEdit && <button className="primary-btn" onClick={() => open()}><Plus size={18} /> Nuevo {config.singular}</button>}</div>
    <div className="toolbar"><div className="search"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={`Buscar en ${config.title.toLowerCase()}…`} /></div>{canEdit && <><input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={event => { void importFile(event.target.files?.[0]); }} /><button className="secondary-btn" onClick={() => fileRef.current?.click()}><Upload size={17} /> Importar</button></>}<a className="secondary-btn" href={`/api/reports/export?entity=${entity}${taskQuery ? `&${taskQuery}` : ""}`}><Download size={17} /> Exportar a Excel</a></div>
    {entity === "tasks" && <TaskFilters viewer={viewer} people={people} scope={taskScope} role={taskRole} person={taskPerson}
      onScope={value => { setTaskScope(value); setTaskRole(""); setTaskPerson(""); }}
      onRole={value => { setTaskRole(value); setTaskScope(""); }}
      onPerson={value => { setTaskPerson(value); setTaskScope(""); }} />}
    {error && <div className="notice error">{error}</div>}
    {entity === "stock" && <StockSummary items={items} />}
    <section className="table-panel"><div className="table-scroll"><table><thead><tr>{config.columns.map(column => <th key={column}>{columnLabels[column] || column}</th>)}<th /></tr></thead><tbody>{items.map(item => {
      const rowEditable = inlineEntities.has(entity) && canEdit;
      return <tr key={item._id} className={rowEditable ? "clickable-row" : ""} onClick={rowEditable ? () => open(item) : undefined} onKeyDown={rowEditable ? event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(item); } } : undefined} tabIndex={rowEditable ? 0 : undefined} title={rowEditable ? (entity === "tasks" ? "Abrir detalle de la tarea" : "Abrir para editar") : undefined}>
        {config.columns.map(column => <td key={column} data-label={columnLabels[column] || column}>{inlineStatusEntities.has(entity) && column === "status" && canEdit ? (() => {
          const pending = pendingStatus?.id === item._id ? pendingStatus.status : "";
          return <div className="status-cell" onClick={event => event.stopPropagation()}>
            <select className={`inline-status ${pending || item.status}${pending ? " pending" : ""}`} value={pending || String(item.status || "")} disabled={statusBusy === item._id}
              onChange={event => { event.stopPropagation(); askStatus(item, event.target.value); }} aria-label={`Estado de ${itemLabel(item)}`}>
              {statusOptions.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}
            </select>
            {pending && <span className="status-confirm">
              <b>Queda guardado como {titleCase(pending)}</b>
              <button type="button" className="status-confirm-yes" onClick={() => { void updateStatus(item, pending); }} aria-label={`Confirmar el cambio a ${titleCase(pending)}`}><Check size={14} /> Confirmar</button>
              <button type="button" className="status-confirm-no" onClick={() => setPendingStatus(null)} aria-label="Dejarlo como estaba"><X size={14} /></button>
            </span>}
          </div>;
        })() : display(column, item[column])}</td>)}
        <td className="row-actions" onClick={event => event.stopPropagation()}>
          {entity === "works" && <Link title="Abrir obra" href={`/app/works/${item._id}`}><Eye size={16} /></Link>}
          {entity === "quotes" && canEdit && item.status === "aprobada" && <button className="row-action-wide convert" title="Crear la obra a partir de esta cotización" onClick={() => setConvertFor(item)}><BriefcaseBusiness size={15} /> Pasar a obra</button>}
          {entity === "quotes" && canEdit && approvable.has(String(item.status)) && <button className="row-action-wide approve" title="Marcar la cotización como aprobada" disabled={statusBusy === item._id} onClick={() => { void approveQuote(item); }}><CheckCircle2 size={15} /> Aprobar</button>}
          {entity === "stock" && canEdit && <button title="Registrar una compra" onClick={() => setMovementFor({ item: item as unknown as StockItem, kind: "ingreso" })}><ArrowDownToLine size={16} /></button>}
          {entity === "stock" && canEdit && <button title="Entregar a una obra" onClick={() => setMovementFor({ item: item as unknown as StockItem, kind: "egreso" })}><HardHat size={16} /></button>}
          {entity !== "tasks" && <button title="Ver historial de cambios" onClick={() => setHistoryFor({ _id: item._id, label: itemLabel(item) })}><History size={16} /></button>}
          {canEdit && <button title={entity === "tasks" ? "Ver y editar tarea" : "Editar"} onClick={() => open(item)}><Edit3 size={16} /></button>}
          {canDeleteRecords && <button title="Eliminar" onClick={() => { void remove(item); }}><Trash2 size={16} /></button>}
        </td>
      </tr>;
    })}</tbody></table></div>{loading ? <div className="loading-state">Cargando…</div> : !items.length && <div className="empty-state compact"><p>No hay registros para mostrar.</p>{canEdit && <button onClick={() => open()}>Crear {config.singular}</button>}</div>}</section>

    {modal && entity === "tasks" && <TaskModal task={editing} config={config} fieldProps={fieldProps} error={error} saving={saving} onClose={() => setModal(false)} onSubmit={submit} />}
    {modal && entity !== "tasks" && <div className="modal-layer"><button className="modal-backdrop" onClick={() => setModal(false)} aria-label="Cerrar" /><section className={`modal entity-modal ${entity === "works" ? "work-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="entity-modal-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon">{entity === "works" ? <HardHat /> : <Edit3 />}</span><div>
        {/* En una obra manda el nombre: el título dice de qué obra se trata, no "editar registro". */}
        <p className="eyebrow">{entity === "works" && editing ? `OBRA ${String(editing.code || "")}` : editing ? "EDITAR REGISTRO" : "NUEVO REGISTRO"}</p>
        <h2 id="entity-modal-title">{entity === "works" && editing ? String(editing.name || "Obra") : editing ? `Editar ${config.singular}` : `Nuevo ${config.singular}`}</h2>
        <small>{entity === "works" && editing ? `Avance ${Number(editing.progress || 0)}% · Presupuesto ${money(Number(editing.budgetCents || 0))}` : entity === "works" ? "Información general, planificación y control de la obra" : `Completá los datos del ${config.singular}`}</small>
      </div></div>
      {entity === "works" && editing && <div className="modal-head-actions">
        <Link className="secondary-btn" href={`/app/works/${editing._id}#personal`}><Users size={16} /> Personal asignado</Link>
        {canEdit && <button type="button" className="primary-btn" onClick={() => setInvoiceFor(editing)}><FileCheck2 size={16} /> Facturar</button>}
      </div>}
      <button className="icon-btn" onClick={() => setModal(false)} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={submit}>
        <div className="modal-form-body">{entity === "works"
          ? <WorkFields fields={config.fields} fieldProps={fieldProps} />
          : <div className="form-grid">{config.fields.map((field, index) => <FormField key={field.key} {...fieldProps(field)} autoFocus={index === 0} />)}</div>}
        </div>
        {error && <p className="form-error modal-error">{error}</p>}
        <footer><span>Los cambios quedan registrados automáticamente.</span><button type="button" className="secondary-btn" onClick={() => setModal(false)}>Cancelar</button><button className="primary-btn" disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</button></footer>
      </form>
      {editing && <div className="modal-form-body"><RecordHistory entity={entity} recordId={editing._id} embedded /></div>}
    </section></div>}

    {quickCreate && <QuickCreateModal entity={quickCreate.entity} onClose={() => setQuickCreate(null)} onCreated={item => {
      setRelations(current => ({ ...current, [quickCreate.entity]: [item, ...(current[quickCreate.entity] || [])] }));
      setRelationValues(current => ({ ...current, [quickCreate.fieldKey]: item._id }));
      setQuickCreate(null);
    }} />}

    {invoiceFor && <InvoiceWorkModal work={invoiceFor as unknown as InvoiceableWork}
      onClose={() => setInvoiceFor(null)}
      onDone={updated => { setInvoiceFor(null); setModal(false); setItems(current => current.map(row => row._id === (updated as Item)._id ? { ...row, ...updated as Item } : row)); }} />}

    {convertFor && <ConvertQuoteModal quote={convertFor} client={(relations.clients || []).find(row => row._id === String(convertFor.clientId || ""))}
      onClose={() => setConvertFor(null)} onDone={() => { setConvertFor(null); void load(); }} />}

    {movementFor && <StockMovementModal item={movementFor.item} initialKind={movementFor.kind}
      onClose={() => setMovementFor(null)}
      onSaved={updated => { setItems(current => current.map(row => row._id === updated._id ? { ...row, ...updated } as Item : row)); setMovementFor({ item: updated, kind: movementFor.kind }); }} />}

    {historyFor && <HistoryModal entity={entity} record={historyFor} onClose={() => setHistoryFor(null)} />}
  </>;
}

/**
 * Filtros de Tareas.
 *
 * Todo el mundo tiene los dos atajos: lo que lleva su nombre y lo de su área.
 * Fuera de gerencia esas son además las únicas tareas que existen para esa
 * persona — el recorte lo hace el servidor, no estos botones. Gerencia ve todo
 * y encima puede mirar el tablero de otra área o de alguien en particular.
 */
function TaskFilters({ viewer, people, scope, role, person, onScope, onRole, onPerson }: {
  viewer: Viewer; people: Person[]; scope: string; role: string; person: string;
  onScope: (value: "" | "mine" | "area") => void; onRole: (value: string) => void; onPerson: (value: string) => void;
}) {
  const isAdmin = viewer.role === "gerencia";
  const all = !scope && !role && !person;
  return <div className="task-filters">
    <div className="task-filter-chips">
      <button type="button" className={all ? "active" : ""} onClick={() => onScope("")}>{isAdmin ? "Todas" : "Todo lo mío"}</button>
      <button type="button" className={scope === "mine" ? "active" : ""} onClick={() => onScope("mine")}><UserRound size={15} /> Asignadas a mí</button>
      <button type="button" className={scope === "area" ? "active" : ""} onClick={() => onScope("area")}><Users size={15} /> Mi área ({roleLabels[viewer.role]})</button>
    </div>
    {isAdmin
      ? <div className="task-filter-selects">
          <label><span>Área</span><select value={role} onChange={event => onRole(event.target.value)}>
            <option value="">Todas las áreas</option>
            {ROLES.map(option => <option key={option} value={option}>{roleLabels[option]}</option>)}
          </select></label>
          <label><span>Persona</span><select value={person} onChange={event => onPerson(event.target.value)}>
            <option value="">Cualquiera</option>
            {people.map(option => <option key={option._id} value={option._id}>{option.name}</option>)}
          </select></label>
        </div>
      : <p className="task-filter-note">Ves las tareas de tu área y las que están a tu nombre.</p>}
  </div>;
}

/**
 * Pasar una cotización a obra. Antes eran tres `prompt()` del navegador, que no
 * dejaban poner la fecha de inicio: justo el dato que Compras necesita para
 * saber cuándo preparar los materiales.
 *
 * Sale solo al aprobar la cotización. Desde acá hay dos caminos: crear la obra
 * y nada más, o facturar un porcentaje del trabajo en el mismo movimiento —el
 * botón del medio abre el campo del porcentaje y el segundo clic ejecuta—, que
 * además del certificado deja la factura de avance en PDF.
 */
function ConvertQuoteModal({ quote, client, onClose, onDone }: { quote: Item; client?: Item; onClose: () => void; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [billing, setBilling] = useState(false);
  const [percentage, setPercentage] = useState("");
  const percentRef = useRef<HTMLInputElement>(null);
  // Qué botón disparó el envío: los dos son submit del mismo formulario.
  const action = useRef<"work" | "invoice">("work");
  // Si la obra ya se creó y falló lo de después, no se vuelve a convertir.
  const created = useRef<Item | null>(null);

  const budgetCents = Number(quote.amountCents || 0);
  const percent = Number(percentage) || 0;
  const invoiceCents = Math.round(budgetCents * percent / 100);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => { if (billing) percentRef.current?.focus(); }, [billing]);

  /** La factura de avance en PDF, con el logo del sitio incrustado. */
  async function downloadInvoice(work: Item, number: string, period: string) {
    const [{ jsPDF }, logo, session] = await Promise.all([
      import("jspdf"),
      readBrandLogo(),
      fetch("/api/auth/me").then(response => response.ok ? response.json() : null).catch(() => null),
    ]);
    const doc = new jsPDF();
    const filename = buildInvoicePdf(doc, {
      number, period, percentage: percent, amountCents: invoiceCents,
      client: { name: String(client?.name || "—"), cuit: String(client?.cuit || ""), address: String(client?.address || ""), email: String(client?.email || "") },
      quote: { number: String(quote.number || ""), title: String(quote.title || ""), description: String(quote.description || ""), amountCents: budgetCents },
      work: { code: String(work.code || ""), name: String(work.name || ""), startDate: String(work.startDate || "") },
    }, { author: session?.name || "el sistema", logo });
    doc.save(filename);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invoicing = action.current === "invoice";
    if (invoicing && percent <= 0) return setError("Poné qué porcentaje de la obra vas a facturar");
    setSaving(true); setError("");
    const data = new FormData(event.currentTarget);

    let work = created.current;
    if (!work) {
      const response = await fetch(`/api/quotes/${quote._id}/convert`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: String(data.get("code") || ""), name: String(data.get("name") || ""), startDate: String(data.get("startDate") || "") || undefined }),
      });
      const result = await response.json();
      if (!response.ok) { setSaving(false); return setError(result.error || "No se pudo crear la obra"); }
      work = result as Item;
      created.current = work;
    }
    if (!invoicing) { setSaving(false); return onDone(); }

    // El avance se guarda como certificado aprobado: eso avisa a Administración
    // y le deja la tarea de emitir la factura de verdad.
    const number = `${String(work.code || "")}-C1`;
    const period = currentPeriod();
    const response = await fetch(`/api/works/${work._id}/certificates`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ number, period, percentage: percent, amountCents: invoiceCents, approved: true, file: "" }),
    });
    const result = await response.json();
    if (!response.ok) { setSaving(false); return setError(`La obra ${String(work.code || "")} quedó creada, pero no se pudo facturar el avance: ${result.error || "error inesperado"}`); }
    try { await downloadInvoice(work, number, period); }
    catch { setSaving(false); return setError(`Se facturó el ${percent}% de la obra ${String(work.code || "")}, pero no se pudo generar el PDF. Podés volver a emitirlo desde la obra.`); }
    setSaving(false);
    onDone();
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal convert-modal" role="dialog" aria-modal="true" aria-labelledby="convert-modal-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><BriefcaseBusiness /></span><div>
        <p className="eyebrow">COTIZACIÓN APROBADA</p>
        <h2 id="convert-modal-title">Pasar {String(quote.number || "")} a obra</h2>
        <small>{String(quote.title || "")}{client ? ` · ${itemLabel(client)}` : ""}</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={submit}>
        <div className="modal-form-body">
          <p className="convert-warning"><TriangleAlert size={17} /><span>Estás por convertir esta cotización en una obra. Va a salir del listado activo, no se va a poder volver a convertir y queda registrado que la pasaste vos. Compras recibe el aviso con la fecha de inicio.</span></p>
          <div className="form-grid">
            <label><span>Código de la obra *</span><input name="code" required defaultValue={`OB-${String(quote.number || "")}`} autoFocus /></label>
            <label><span>Nombre de la obra *</span><input name="name" required defaultValue={String(quote.title || "")} /></label>
            <label><span>Fecha de inicio</span><DateInput name="startDate" quickRanges={[7, 14, 30]} /></label>
            <label className="readonly-field"><span>Presupuesto que hereda</span><output>{money(budgetCents)}</output></label>
          </div>

          {billing && <div className="convert-billing">
            <p className="eyebrow">FACTURAR AVANCE</p>
            <div className="form-grid">
              <label><span>¿Qué porcentaje facturás? *</span>
                <div className="percent-input">
                  {/* Sin `required`: con el campo abierto todavía se puede crear la obra sin facturar. */}
                  <input ref={percentRef} type="number" min="0.1" max="100" step="0.1" value={percentage}
                    onChange={event => setPercentage(event.target.value)} />
                  <Percent size={15} />
                </div>
                <div className="percent-quick">{[25, 50, 70, 100].map(value => <button key={value} type="button" className={percent === value ? "active" : ""} onClick={() => setPercentage(String(value))}>{value}%</button>)}</div>
              </label>
              <label className="readonly-field"><span>Importe a facturar</span><output>{money(invoiceCents)}</output></label>
            </div>
            <p className="invoice-note">
              {percent > 0
                ? <>Se certifica el <b>{percent}%</b> de {money(budgetCents)} = <b>{money(invoiceCents)}</b>. Se descarga la factura de avance en PDF (sin validez fiscal) y Administración recibe el aviso para emitir la factura real.</>
                : <>Elegí el porcentaje que vas a facturar y el importe se calcula solo.</>}
            </p>
          </div>}
        </div>
        {error && <p className="form-error modal-error">{error}</p>}
        <footer>
          <span>Queda auditado.</span>
          <button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button>
          <button type={billing ? "submit" : "button"} className="secondary-btn convert-invoice-btn" disabled={saving}
            onClick={() => { if (!billing) { setBilling(true); setError(""); return; } action.current = "invoice"; }}>
            <FileCheck2 size={16} /> {billing && percent > 0 ? `Facturar el ${percent}% y pasar a obra` : "Facturar y pasar a obra"}
          </button>
          <button className="primary-btn" disabled={saving} onClick={() => { action.current = "work"; }}>{saving ? "Creando la obra…" : "Sí, crear la obra"}</button>
        </footer>
      </form>
    </section>
  </div>;
}

/** Cabecera del stock: cuánto hay guardado y qué está por debajo del mínimo. */
function StockSummary({ items }: { items: Item[] }) {
  const valued = items.reduce((total, item) => total + Number(item.valueCents || 0), 0);
  const low = items.filter(item => Number(item.minQuantity || 0) > 0 && Number(item.quantity || 0) <= Number(item.minQuantity || 0));
  return <section className="stock-overview">
    <div className="stock-kpi"><span>Materiales en catálogo</span><strong>{items.length}</strong></div>
    <div className="stock-kpi"><span>Valorización del depósito</span><strong>{money(valued)}</strong></div>
    <div className={low.length ? "stock-kpi alert" : "stock-kpi"}>
      <span>{low.length ? <><TriangleAlert size={13} /> Bajo el mínimo</> : "Bajo el mínimo"}</span>
      <strong>{low.length}</strong>
      {low.length > 0 && <small>{low.slice(0, 3).map(item => String(item.name)).join(", ")}{low.length > 3 ? ` y ${low.length - 3} más` : ""}</small>}
    </div>
  </section>;
}

/** Traduce los errores por campo que devuelve zod a una frase legible. */
function fieldErrors(result: { details?: { fieldErrors?: Record<string, string[]> } }) {
  const byField = result.details?.fieldErrors;
  if (!byField) return "";
  const messages = Object.values(byField).flat().filter(Boolean);
  return messages.length ? messages.join(". ") : "";
}

type FieldProps = {
  field: Field;
  value: unknown;
  relationOptions: Option[];
  personOptions: Option[];
  relationValue: string;
  onRelationChange: (value: string) => void;
  onCreateRelation?: () => void;
};

const workGroups = [
  { title: "Identificación", description: "Datos principales de la obra", keys: ["code", "name", "clientId", "quoteId"] },
  { title: "Planificación", description: "Fechas, estado y avance", keys: ["startDate", "endDate", "status", "progress"] },
  { title: "Control económico", description: "Presupuesto y centro de costo", keys: ["budgetCents", "costCenter"] },
];

function WorkFields({ fields, fieldProps }: { fields: Field[]; fieldProps: (field: Field) => FieldProps }) {
  return <div className="work-form-sections">{workGroups.map((group, groupIndex) => <fieldset key={group.title}><legend><b>{group.title}</b><small>{group.description}</small></legend><div className="form-grid">{group.keys.map((key, index) => {
    const field = fields.find(candidate => candidate.key === key);
    return field ? <FormField key={field.key} {...fieldProps(field)} autoFocus={groupIndex === 0 && index === 0} /> : null;
  })}</div></fieldset>)}</div>;
}

function TaskModal({ task, config, fieldProps, error, saving, onClose, onSubmit }: { task: Item | null; config: typeof entityConfig["tasks"]; fieldProps: (field: Field) => FieldProps; error: string; saving: boolean; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const status = String(task?.status || "pendiente");
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" /><section className="modal entity-modal task-modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title">
    <header><div className="modal-title-wrap"><span className="modal-heading-icon"><ListTodo /></span><div><p className="eyebrow">{task ? "DETALLE DE TAREA" : "NUEVA TAREA"}</p><h2 id="task-modal-title">{task ? String(task.title || "Tarea") : "Nueva tarea"}</h2><small>Seguimiento operativo con trazabilidad de cada modificación</small></div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
    {task && <div className="task-summary"><div className="task-summary-icon"><ListTodo size={21} /></div><div><span>Estado actual</span><strong className={`badge ${status}`}>{titleCase(status)}</strong></div><div><span>Vencimiento</span><strong><CalendarDays size={14} />{date(task.dueDate as string)}</strong></div><div><span>Responsable</span><strong><UserRound size={14} />{task.assigneeRole ? titleCase(String(task.assigneeRole)) : "Sin asignar"}</strong></div></div>}
    <form onSubmit={onSubmit}><div className="modal-form-body"><div className="task-form-heading"><div><p className="eyebrow">INFORMACIÓN</p><h3>Datos de la tarea</h3></div><span>Los cambios quedan registrados automáticamente.</span></div><div className="form-grid">{config.fields.map((field, index) => <FormField key={field.key} {...fieldProps(field)} value={task?.[field.key]} autoFocus={index === 0} />)}</div></div>{error && <p className="form-error modal-error">{error}</p>}<footer><span>Usuario, fecha y hora se guardan en cada cambio.</span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</button></footer></form>
    {task && <div className="modal-form-body"><RecordHistory entity="tasks" recordId={task._id} embedded /></div>}
  </section></div>;
}

/** Alta rápida de un registro relacionado (típicamente un cliente) sin salir del formulario. */
function QuickCreateModal({ entity, onClose, onCreated }: { entity: Entity; onClose: () => void; onCreated: (item: Item) => void }) {
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
    onCreated(result as Item);
  }

  return <div className="modal-layer quick-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal quick-modal" role="dialog" aria-modal="true" aria-labelledby="quick-modal-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Plus /></span><div><p className="eyebrow">ALTA RÁPIDA</p><h2 id="quick-modal-title">Nuevo {config.singular}</h2><small>Se crea acá mismo y queda elegido en el formulario</small></div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={submit}>
        <div className="modal-form-body"><div className="form-grid">{fields.map((field, index) => <FormField key={field.key} field={field} value={undefined} relationOptions={[]} personOptions={[]} relationValue="" onRelationChange={() => {}} autoFocus={index === 0} />)}</div></div>
        {error && <p className="form-error modal-error">{error}</p>}
        <footer><span>Después lo podés completar desde su módulo.</span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={saving}>{saving ? "Creando…" : `Crear ${config.singular}`}</button></footer>
      </form>
    </section>
  </div>;
}

function FormField({ field, value, relationOptions, personOptions, relationValue, onRelationChange, onCreateRelation, autoFocus = false }: FieldProps & { autoFocus?: boolean }) {
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
    step={field.key === "progress" ? "1" : undefined} min={field.type === "number" ? "0" : undefined} placeholder={field.placeholder} /></label>;
}
