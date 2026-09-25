"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, Check, ListTodo, Play, UserRound } from "lucide-react";
import { roleLabels, type Role } from "@/lib/constants";
import { date, todayIso } from "@/lib/format";

type Task = { _id: string; title: string; description?: string; status: "pendiente" | "en_curso" | "completada"; dueDate?: string; assigneeRole?: Role; assigneeName?: string };

/** Días que faltan para el vencimiento (negativo si ya venció), contando en fechas de calendario. */
function daysUntil(due: string) {
  const [year, month, day] = todayIso().split("-").map(Number);
  return Math.round((new Date(due).getTime() - Date.UTC(year, month - 1, day)) / 86_400_000);
}

function dueText(due?: string) {
  if (!due) return { text: "Sin vencimiento", tone: "" };
  const days = daysUntil(due);
  if (days < 0) return { text: `Venció hace ${-days} ${days === -1 ? "día" : "días"}`, tone: "overdue" };
  if (days === 0) return { text: "Vence hoy", tone: "today" };
  if (days === 1) return { text: "Vence mañana", tone: "soon" };
  return { text: `Vence el ${date(due)}`, tone: days <= 3 ? "soon" : "" };
}

/**
 * Las tareas sin terminar, al lado de la campanita: lo vencido primero y
 * después por fecha. Se empiezan o se completan desde acá sin entrar al
 * módulo. El servidor ya recorta lo que cada uno ve (su área y lo suyo; todo
 * para gerencia). Se refresca cada minuto, igual que los avisos.
 */
export function TasksButton() {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => fetch("/api/records/tasks?limit=100")
    .then(response => response.ok ? response.json() as Promise<{ items?: Task[] }> : null)
    .then(result => {
      if (!result) return;
      const unfinished = (result.items || []).filter(task => task.status !== "completada");
      // Vencidas y próximas arriba; sin fecha, al final.
      unfinished.sort((a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity));
      setTasks(unfinished);
    })
    // Si el servidor no responde, la lista se queda como estaba.
    .catch(() => {}), []);

  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 60000);
    void load();
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mousedown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  async function setStatus(task: Task, status: Task["status"]) {
    setBusy(task._id); setError("");
    const response = await fetch(`/api/records/tasks/${task._id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    if (!response.ok) setError((await response.json().catch(() => ({}))).error || "No se pudo cambiar la tarea");
    await load();
    setBusy("");
  }

  const count = tasks.length;
  const overdue = tasks.filter(task => task.dueDate && daysUntil(task.dueDate) < 0).length;

  return <div className="notif-wrap tasks-wrap" ref={wrapRef}>
    <button type="button" className={count ? "notif-btn has-unread" : "notif-btn"} onClick={() => { setOpen(value => !value); if (!open) void load(); }}
      aria-expanded={open} aria-label={count ? `Tareas y pendientes: ${count} sin terminar` : "Tareas y pendientes"} title="Tareas y pendientes">
      <ListTodo size={19} />
      {count > 0 && <span className={overdue ? "tasks-count overdue" : "tasks-count"}>{count > 99 ? "99+" : count}</span>}
    </button>

    {open && <div className="notif-panel tasks-panel">
      <header>
        <div><p className="eyebrow">PENDIENTES</p><h3>Tareas sin terminar</h3></div>
        <p className="tasks-summary">{count ? `${count} ${count === 1 ? "tarea" : "tareas"}${overdue ? ` · ${overdue} ${overdue === 1 ? "vencida" : "vencidas"}` : ""}` : "Estás al día."}</p>
      </header>
      {error && <p className="tasks-error">{error}</p>}
      <div className="notif-list">
        {!count && <p className="notif-empty">No tenés tareas pendientes.</p>}
        {tasks.map(task => {
          const due = dueText(task.dueDate);
          return <article key={task._id} className={`notif-item task-item ${task.status}`}>
            <div className="notif-item-head">
              <span className={`task-state ${task.status}`}>{task.status === "en_curso" ? "En curso" : "Pendiente"}</span>
              <span className={`task-due ${due.tone}`}><CalendarClock size={12} /> {due.text}</span>
            </div>
            <b>{task.title}</b>
            {task.description && <p>{task.description}</p>}
            {(task.assigneeName || task.assigneeRole) && <small className="task-owner"><UserRound size={12} /> {task.assigneeName || (task.assigneeRole ? roleLabels[task.assigneeRole] : "")}{task.assigneeName && task.assigneeRole ? ` · ${roleLabels[task.assigneeRole]}` : ""}</small>}
            <div className="notif-actions">
              {task.status === "pendiente" && <button className="notif-snooze" disabled={busy === task._id} onClick={() => { void setStatus(task, "en_curso"); }}><Play size={13} /> Empezar</button>}
              <button className="notif-done" disabled={busy === task._id} onClick={() => { void setStatus(task, "completada"); }}><Check size={14} /> Completar</button>
            </div>
          </article>;
        })}
      </div>
      <footer className="tasks-panel-foot"><Link href="/app/tasks" onClick={() => setOpen(false)}>Ver todas las tareas →</Link></footer>
    </div>}
  </div>;
}
