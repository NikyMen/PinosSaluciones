"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRing, Check, Clock, History, Inbox, TriangleAlert } from "lucide-react";
import { dateTime } from "@/lib/format";
import { isOpen, notificationStatusLabels } from "@/lib/notification-rules";

type Notification = {
  _id: string; title: string; body?: string; kind: string; href?: string;
  status: string; createdAt: string; remindAt?: string; doneAt?: string; doneByName?: string; dueAt?: string; escalatedAt?: string; assignedToName?: string;
};

const kindLabels: Record<string, string> = {
  obra: "Obra", certificado: "Certificado", cotizacion: "Cotización", compra: "Compra",
  cobranza: "Cobranza", vencimiento: "Vencimiento", stock: "Stock", general: "Aviso",
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"pendientes" | "historial">("pendientes");
  const [items, setItems] = useState<Notification[]>([]);
  const [history, setHistory] = useState<Notification[]>([]);
  const [busy, setBusy] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const [unread, setUnread] = useState(0);

  const load = useCallback((withHistory = false) => fetch(`/api/notifications${withHistory ? "?history=1" : ""}`)
    .then(response => response.ok ? response.json() as Promise<{ items: Notification[]; history: Notification[]; unread: number }> : null)
    .then(result => {
      if (!result) return;
      setItems(result.items || []);
      setUnread(result.unread ?? 0);
      if (withHistory) setHistory(result.history || []);
    })
    // Un corte de red no tiene que romper la campanita: se reintenta al minuto.
    .catch(() => {}), []);

  // Refresca sola cada minuto: así aparece el aviso sin recargar la página.
  useEffect(() => {
    const withHistory = tab === "historial";
    const timer = window.setInterval(() => { void load(withHistory); }, 60000);
    void load(withHistory);
    return () => window.clearInterval(timer);
  }, [load, tab]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mousedown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  /** Al abrir la campanita, lo nuevo pasa a leído. */
  function markRead() {
    const fresh = items.filter(item => item.status === "nueva" || item.status === "pendiente");
    if (!fresh.length) return;
    void Promise.all(fresh.map(item => fetch(`/api/notifications/${item._id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "leer" }) })))
      .then(() => load(tab === "historial"));
  }

  async function act(item: Notification, action: "resolver" | "posponer" | "gestionar") {
    setBusy(item._id);
    await fetch(`/api/notifications/${item._id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(action === "posponer" ? { action, minutes: 60 * 24 } : { action }),
    });
    await load(tab === "historial");
    setBusy("");
  }

  const pending = items.length;
  const list = tab === "pendientes" ? items : history;

  return <div className="notif-wrap" ref={wrapRef}>
    <button className={unread ? "notif-btn has-unread" : "notif-btn"} onClick={() => { setOpen(value => !value); if (!open) markRead(); }}
      aria-expanded={open} aria-label={pending ? `Notificaciones: ${pending} sin resolver${unread ? `, ${unread} nuevas` : ""}` : "Notificaciones"}>
      {unread ? <BellRing size={19} /> : <Bell size={19} />}
      {unread > 0 && <span className="notif-dot" aria-hidden />}
    </button>

    {open && <div className="notif-panel">
      <header>
        <div><p className="eyebrow">AVISOS</p><h3>Notificaciones</h3></div>
        <div className="notif-tabs">
          <button className={tab === "pendientes" ? "active" : ""} onClick={() => { setTab("pendientes"); void load(); }}>Pendientes{pending > 0 && <b>{pending}</b>}</button>
          <button className={tab === "historial" ? "active" : ""} onClick={() => { setTab("historial"); void load(true); }}><History size={13} /> Historial</button>
        </div>
      </header>

      <div className="notif-list">
        {!list.length && <p className="notif-empty">{tab === "pendientes" ? "No tenés avisos pendientes." : "Todavía no hay avisos en el historial."}</p>}
        {list.map(item => <article key={item._id} className={`notif-item kind-${item.kind}${isOpen(item.status) ? "" : " done"}`}>
          <div className="notif-item-head">
            <span className={`notif-kind ${item.kind}`}>{kindLabels[item.kind] || "Aviso"}</span>
            <span className={`notif-status ${item.status}`}>{notificationStatusLabels[item.status] || item.status}{item.assignedToName ? ` · ${item.assignedToName}` : ""}</span>
            <time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time>
          </div>
          {item.escalatedAt && <small className="notif-escalated"><TriangleAlert size={12} /> Escalada a Gerencia: venció el plazo</small>}
          {!item.escalatedAt && item.dueAt && isOpen(item.status) && <small className="notif-due">Resolver antes del {dateTime(item.dueAt)}</small>}
          <b>{item.title}</b>
          {item.body && <p>{item.body}</p>}
          {item.href && <Link href={item.href} onClick={() => setOpen(false)}>Ver el detalle →</Link>}
          {!isOpen(item.status)
            ? <small className="notif-done-note"><Check size={12} /> {notificationStatusLabels[item.status]} por {item.doneByName || "un usuario"} · {dateTime(item.doneAt)}</small>
            : <div className="notif-actions">
              {item.status !== "en_gestion" && <button className="notif-snooze" disabled={busy === item._id} onClick={() => { void act(item, "gestionar"); }}>Lo tomo</button>}
              <button className="notif-done" disabled={busy === item._id} onClick={() => { void act(item, "resolver"); }}><Check size={14} /> Resuelto</button>
              <button className="notif-snooze" disabled={busy === item._id} onClick={() => { void act(item, "posponer"); }}><Clock size={14} /> Mañana</button>
            </div>}
        </article>)}
      </div>
      <Link href="/app/bandeja" className="notif-inbox-link" onClick={() => setOpen(false)}><Inbox size={14} /> Abrir la bandeja: asignar, descartar, filtrar por área</Link>
    </div>}
  </div>;
}
