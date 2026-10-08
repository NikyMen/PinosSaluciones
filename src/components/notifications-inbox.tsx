"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronUp, Inbox, RotateCcw, Save, TriangleAlert, UserPlus, X } from "lucide-react";
import { dateTime } from "@/lib/format";
import { ROLES, roleLabels, type Role } from "@/lib/constants";
import { isOpen, notificationStatusLabels } from "@/lib/notification-rules";

type Notice = {
  _id: string; title: string; body?: string; kind: string; href?: string; roles: Role[]; status: string; createdAt: string;
  dueAt?: string; escalatedAt?: string; assignedToId?: string; assignedToName?: string; doneAt?: string; doneByName?: string; discardReason?: string;
  history?: Array<{ action: string; note?: string; at: string; userName?: string }>;
};
type Person = { _id: string; name: string; role: Role };
type Rule = { event: string; label: string; defaultHours: number; hours: number };

const statusFilters = [
  ["abiertos", "Abiertos"], ["nueva", "Nuevos"], ["leida", "Leídos"], ["en_gestion", "En gestión"], ["vencidos", "Vencidos"], ["resuelta", "Resueltos"], ["descartada", "Descartados"], ["", "Todos"],
] as const;

/**
 * La bandeja de avisos y pendientes (requerimiento integral v4, punto 6): lo de
 * mi área y lo que me asignaron, con su fecha límite. Se toma, se asigna, se
 * resuelve o se descarta con motivo; cada aviso abre su documento. Gerencia ve,
 * además, toda la empresa y define en cuánto tiempo se le escala cada tipo.
 */
export function NotificationsInbox({ viewer }: { viewer: { userId: string; role: Role } }) {
  const manager = viewer.role === "gerencia";
  const [items, setItems] = useState<Notice[] | null>(null);
  const [status, setStatus] = useState<string>("abiertos");
  const [role, setRole] = useState("");
  const [assigned, setAssigned] = useState(false);
  const [all, setAll] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [open, setOpen] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ bandeja: "1", estado: status, ...(role ? { area: role } : {}), ...(assigned ? { asignados: "1" } : {}), ...(all ? { todos: "1" } : {}) });
    const response = await fetch(`/api/notifications?${params.toString()}`);
    const body = await response.json();
    if (!response.ok) { setItems([]); return setError(body.error || "No se pudo leer la bandeja"); }
    setItems(body.items as Notice[]);
  }, [status, role, assigned, all]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { void fetch("/api/users/directory").then(response => response.ok ? response.json() : { items: [] }).then(result => setPeople(result.items || [])).catch(() => setPeople([])); }, []);

  async function act(notice: Notice, body: Record<string, unknown>) {
    setBusy(notice._id); setError("");
    const response = await fetch(`/api/notifications/${notice._id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    setBusy("");
    if (!response.ok) return setError(result.error || "No se pudo");
    await load();
  }

  function discard(notice: Notice) {
    const reason = prompt("¿Por qué se descarta? Queda en el historial del aviso.") || "";
    if (reason.trim().length >= 3) void act(notice, { action: "descartar", reason });
  }

  const [now] = useState(() => Date.now());
  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">GESTIÓN</p>
      <h1><Inbox size={22} /> Bandeja de pendientes</h1>
      <p>Los avisos de tu área y los que te asignaron, con su fecha límite. Si vencen sin resolverse, se escalan a Gerencia. Cada uno abre su documento.</p>
    </div></div>

    <div className="toolbar tracking-toolbar">
      <div className="tracking-filter" role="group" aria-label="Estado">
        {statusFilters.map(([value, label]) => <button key={value} type="button" className={status === value ? "active" : ""} onClick={() => setStatus(value)}>{label}</button>)}
      </div>
      <select value={role} onChange={event => setRole(event.target.value)} aria-label="Área"><option value="">Todas las áreas</option>{ROLES.map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}</select>
      <label className="inline-check"><input type="checkbox" checked={assigned} onChange={event => setAssigned(event.target.checked)} /> Asignados a mí</label>
      {manager && <label className="inline-check"><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)} /> Toda la empresa</label>}
    </div>
    {error && <div className="notice error">{error}</div>}

    <section className="table-panel">
      {items === null ? <div className="loading-state">Cargando…</div> : !items.length ? <div className="empty-state"><p>No hay avisos en esta vista.</p></div>
        : <div className="table-scroll"><table><thead><tr><th>Aviso</th><th>Área</th><th>Asignado</th><th>Límite</th><th>Estado</th><th /></tr></thead><tbody>
          {items.map(notice => {
            const late = isOpen(notice.status) && notice.dueAt && new Date(notice.dueAt).getTime() < now;
            return <tr key={notice._id} className={late ? "row-alert" : ""}>
              <td data-label="Aviso"><b>{notice.title}</b>{notice.body && <small className="tracking-sub">{notice.body}</small>}
                {notice.href && <Link href={notice.href} className="tracking-sub">Abrir el documento →</Link>}
                {open === notice._id && <ul className="purchase-history">{(notice.history || []).map((entry, index) => <li key={index}><b>{entry.action}</b>{entry.note ? `: ${entry.note}` : ""}<small>{dateTime(entry.at)}{entry.userName ? ` · ${entry.userName}` : ""}</small></li>)}</ul>}</td>
              <td data-label="Área">{notice.roles.map(value => roleLabels[value] || value).join(", ")}</td>
              <td data-label="Asignado">{isOpen(notice.status)
                ? <select value={notice.assignedToId || ""} disabled={busy === notice._id} onChange={event => event.target.value && void act(notice, { action: "asignar", userId: event.target.value })} aria-label="Asignar a">
                  <option value="">{notice.assignedToName || "Sin asignar"}</option>
                  {people.filter(person => notice.roles.includes(person.role) || manager).map(person => <option key={person._id} value={person._id}>{person.name}</option>)}
                </select>
                : notice.assignedToName || "—"}</td>
              <td data-label="Límite">{notice.dueAt ? dateTime(notice.dueAt) : "Sin plazo"}{notice.escalatedAt && <small className="tracking-sub"><TriangleAlert size={12} /> Escalada a Gerencia</small>}</td>
              <td data-label="Estado"><span className={`badge notif-${notice.status}`}>{notificationStatusLabels[notice.status] || notice.status}</span>
                {notice.status === "descartada" && notice.discardReason && <small className="tracking-sub">{notice.discardReason}</small>}
                {!isOpen(notice.status) && notice.doneByName && <small className="tracking-sub">{notice.doneByName} · {notice.doneAt ? dateTime(notice.doneAt) : ""}</small>}</td>
              <td className="row-actions">
                {isOpen(notice.status) && notice.status !== "en_gestion" && <button type="button" className="row-action-wide" disabled={busy === notice._id} onClick={() => { void act(notice, { action: "gestionar" }); }}><UserPlus size={14} /> Lo tomo</button>}
                {isOpen(notice.status) && <button type="button" className="row-action-wide approve" disabled={busy === notice._id} onClick={() => { void act(notice, { action: "resolver" }); }}><Check size={14} /> Resuelto</button>}
                {isOpen(notice.status) && <button type="button" title="Descartar, con motivo" disabled={busy === notice._id} onClick={() => discard(notice)}><X size={15} /></button>}
                {!isOpen(notice.status) && <button type="button" className="row-action-wide" disabled={busy === notice._id} onClick={() => { void act(notice, { action: "reabrir" }); }}><RotateCcw size={14} /> Reabrir</button>}
                <button type="button" title="Historial" onClick={() => setOpen(open === notice._id ? "" : notice._id)}>{open === notice._id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
              </td>
            </tr>;
          })}
        </tbody></table></div>}
    </section>

    {manager && <EscalationRules />}
  </>;
}

/** Gerencia: en cuántas horas se le escala cada tipo de aviso sin resolver. */
function EscalationRules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [shown, setShown] = useState(false);
  const [saved, setSaved] = useState("");
  useEffect(() => { void fetch("/api/notifications/settings").then(response => response.ok ? response.json() : { items: [] }).then(result => setRules(result.items || [])); }, []);

  async function save() {
    const hours = Object.fromEntries(rules.filter(rule => rule.hours !== rule.defaultHours).map(rule => [rule.event, rule.hours]));
    const response = await fetch("/api/notifications/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ hours }) });
    setSaved(response.ok ? "Guardado: rige para los avisos nuevos." : "No se pudo guardar");
  }

  return <section className="panel">
    <div className="panel-head"><h2 className="section-title">Plazos y escalamiento</h2>
      <button type="button" className="link-btn" onClick={() => setShown(value => !value)}>{shown ? "Ocultar" : "Ver y cambiar"}</button></div>
    {shown && <>
      <p className="muted">En cuántas horas tiene que resolverse cada tipo de aviso. Si se vence, te llega a vos (Gerencia).</p>
      <table className="picked-lines"><thead><tr><th>Evento</th><th>Horas</th></tr></thead><tbody>
        {rules.map((rule, index) => <tr key={rule.event}><td>{rule.label}</td>
          <td><input type="number" min={1} max={2160} value={rule.hours} onChange={event => setRules(current => current.map((row, position) => position === index ? { ...row, hours: Number(event.target.value) || row.defaultHours } : row))} aria-label={`Horas para ${rule.label}`} /></td></tr>)}
      </tbody></table>
      <div className="purchase-actions"><button type="button" className="primary-btn" onClick={() => { void save(); }}><Save size={15} /> Guardar plazos</button>{saved && <span className="muted">{saved}</span>}</div>
    </>}
  </section>;
}
