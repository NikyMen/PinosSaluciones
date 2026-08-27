"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRing, Check, Clock, History } from "lucide-react";
import { dateTime } from "@/lib/format";

type Notification = {
  _id: string; title: string; body?: string; kind: string; href?: string;
  status: "pendiente" | "pospuesta" | "hecha"; createdAt: string; remindAt?: string; doneAt?: string; doneByName?: string;
};

const kindLabels: Record<string, string> = {
  obra: "Obra", certificado: "Certificado", cotizacion: "Cotización",
  cobranza: "Cobranza", vencimiento: "Vencimiento", stock: "Stock", general: "Aviso",
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"pendientes" | "historial">("pendientes");
  const [items, setItems] = useState<Notification[]>([]);
  const [history, setHistory] = useState<Notification[]>([]);
  const [busy, setBusy] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback((withHistory = false) => fetch(`/api/notifications${withHistory ? "?history=1" : ""}`)
    .then(response => response.ok ? response.json() as Promise<{ items: Notification[]; history: Notification[] }> : null)
    .then(result => {
      if (!result) return;
      setItems(result.items || []);
      if (withHistory) setHistory(result.history || []);
    }), []);

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

  async function act(item: Notification, action: "hecha" | "posponer") {
    setBusy(item._id);
    await fetch(`/api/notifications/${item._id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(action === "posponer" ? { action, minutes: 60 * 24 } : { action }),
    });
    await load(tab === "historial");
    setBusy("");
  }

  const unread = items.length;
  const list = tab === "pendientes" ? items : history;

  return <div className="notif-wrap" ref={wrapRef}>
    <button className={unread ? "notif-btn has-unread" : "notif-btn"} onClick={() => { setOpen(value => !value); if (!open) void load(tab === "historial"); }}
      aria-expanded={open} aria-label={unread ? `Notificaciones: ${unread} sin resolver` : "Notificaciones"}>
      {unread ? <BellRing size={19} /> : <Bell size={19} />}
      {unread > 0 && <span className="notif-dot" aria-hidden />}
    </button>

    {open && <div className="notif-panel">
      <header>
        <div><p className="eyebrow">AVISOS</p><h3>Notificaciones</h3></div>
        <div className="notif-tabs">
          <button className={tab === "pendientes" ? "active" : ""} onClick={() => { setTab("pendientes"); void load(); }}>Pendientes{unread > 0 && <b>{unread}</b>}</button>
          <button className={tab === "historial" ? "active" : ""} onClick={() => { setTab("historial"); void load(true); }}><History size={13} /> Historial</button>
        </div>
      </header>

      <div className="notif-list">
        {!list.length && <p className="notif-empty">{tab === "pendientes" ? "No tenés avisos pendientes." : "Todavía no hay avisos en el historial."}</p>}
        {list.map(item => <article key={item._id} className={`notif-item kind-${item.kind}${item.status === "hecha" ? " done" : ""}`}>
          <div className="notif-item-head">
            <span className={`notif-kind ${item.kind}`}>{kindLabels[item.kind] || "Aviso"}</span>
            <time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time>
          </div>
          <b>{item.title}</b>
          {item.body && <p>{item.body}</p>}
          {item.href && <Link href={item.href} onClick={() => setOpen(false)}>Ver el detalle →</Link>}
          {item.status === "hecha"
            ? <small className="notif-done-note"><Check size={12} /> Marcada como hecha por {item.doneByName || "un usuario"} · {dateTime(item.doneAt)}</small>
            : <div className="notif-actions">
              <button className="notif-done" disabled={busy === item._id} onClick={() => { void act(item, "hecha"); }}><Check size={14} /> Hecho</button>
              <button className="notif-snooze" disabled={busy === item._id} onClick={() => { void act(item, "posponer"); }}><Clock size={14} /> Recordármelo mañana</button>
            </div>}
        </article>)}
      </div>
    </div>}
  </div>;
}
