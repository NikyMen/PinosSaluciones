"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BriefcaseBusiness, ExternalLink, GitBranch, HandCoins, ShoppingCart, Store, X } from "lucide-react";
import { money } from "@/lib/format";
import type { DocumentThread, ThreadGroup, ThreadKind, ThreadNode } from "@/lib/document-thread";

/*
 * El botón Historial y su ventana: el hilo de documentos de un comprobante, en
 * orden de fecha, con los cuatro conjuntos del circuito (Cotización / Obra,
 * Compras, Ventas y Tesorería). Lo arma /api/thread/[kind]/[id].
 */

const GROUPS: Array<{ key: ThreadGroup; label: string; icon: typeof Store }> = [
  { key: "cotizacion", label: "Cotización / Obra", icon: BriefcaseBusiness },
  { key: "compras", label: "Compras", icon: ShoppingCart },
  { key: "ventas", label: "Ventas", icon: Store },
  { key: "tesoreria", label: "Tesorería", icon: HandCoins },
];
const groupLabel = Object.fromEntries(GROUPS.map(group => [group.key, group.label])) as Record<ThreadGroup, string>;

const statusLabels: Record<string, string> = {
  pendiente: "Pendiente", parcial: "Parcial", pagado: "Pagada", pagada: "Pagada", cobrada: "Cobrada", aplicada: "Aplicada", anulado: "Anulado", anulada: "Anulada",
  sustituida: "Sustituida", emitida: "Emitida", aprobada: "Aprobada", borrador: "Borrador", enviada: "Enviada", seguimiento: "En seguimiento", rechazada: "Rechazada",
  vencida: "Vencida", convertida: "Pasada a obra", planificada: "Pendiente de inicio", en_curso: "En curso", pausada: "Pausada", terminada: "Terminada", cerrada: "Cerrada",
  cancelada: "Cancelada", facturado: "Facturado", entregado: "Entregado",
};

const day = (value?: string) => value ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(value)) : "";

export function ThreadButton({ kind, id, className = "row-action-wide", label = "Historial" }: { kind: ThreadKind; id: string; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={className} title="Todo lo vinculado a este documento, en orden: qué se hizo primero y qué después" onClick={() => setOpen(true)}><GitBranch size={15} /> {label}</button>
    {/* Fuera de la fila: si no, la ventana hereda los estilos de la tabla (en el celular, sobre todo). */}
    {open && createPortal(<DocumentThreadModal kind={kind} id={id} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

export function DocumentThreadModal({ kind, id, onClose }: { kind: ThreadKind; id: string; onClose: () => void }) {
  const [data, setData] = useState<DocumentThread | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ThreadGroup | "">("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/thread/${kind}/${id}`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message || "No se pudo leer el historial"); });
    return () => controller.abort();
  }, [kind, id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const root = data?.nodes.find(node => node.root);
  const counts = Object.fromEntries(GROUPS.map(group => [group.key, data?.nodes.filter(node => node.group === group.key).length || 0])) as Record<ThreadGroup, number>;
  const visible = (data?.nodes || []).filter(node => !filter || node.group === filter);
  const hidden = Object.entries(data?.hidden || {}).filter(([, count]) => count);
  const totals = data?.totals;
  const figures = totals ? [
    ["Cotizado", totals.quotedCents], ["Comprado (OC)", totals.orderedCents], ["Facturas de compra", totals.billedPurchasesCents], ["Pagado", totals.paidCents],
    ["Facturado", totals.billedSalesCents], ["Cobrado", totals.collectedCents],
  ].filter(([, cents]) => Number(cents) !== 0) as Array<[string, number]> : [];

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal thread-modal" role="dialog" aria-modal="true" aria-labelledby="thread-title">
      <header>
        <div className="modal-title-wrap"><span className="modal-heading-icon"><GitBranch /></span>
          <div><h2 id="thread-title">Historial</h2><small>{root ? `${root.type} ${root.number} · todo lo vinculado, en orden de fecha` : "Todo lo vinculado, en orden de fecha"}</small></div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button>
      </header>
      <div className="thread-body">
        {!data && !error && <p className="thread-empty">Cargando…</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {data && <>
          {figures.length > 0 && <dl className="thread-totals">{figures.map(([label, cents]) => <div key={label}><dt>{label}</dt><dd>{money(cents)}</dd></div>)}</dl>}
          <div className="thread-filters" role="group" aria-label="Filtrar por conjunto">
            <button type="button" className={filter === "" ? "active" : ""} aria-pressed={filter === ""} onClick={() => setFilter("")}>Todo <b>{data.nodes.length}</b></button>
            {GROUPS.map(group => <button key={group.key} type="button" data-group={group.key} className={filter === group.key ? "active" : ""} aria-pressed={filter === group.key} disabled={!counts[group.key]} onClick={() => setFilter(group.key)}>
              <group.icon size={14} /> {group.label} <b>{counts[group.key]}</b></button>)}
          </div>
          <ol className="thread-list">
            {visible.map(node => <ThreadRow key={`${node.kind}:${node.id}`} node={node} onNavigate={onClose} />)}
          </ol>
          {hidden.length > 0 && <p className="thread-note">También hay {hidden.map(([group, count]) => `${count} de ${groupLabel[group as ThreadGroup]}`).join(", ")} que no tenés permiso para ver.</p>}
          {data.truncated && <p className="thread-note">El hilo es muy grande: se muestran los primeros 200 documentos. Filtrá por conjunto o abrí el historial desde un documento más puntual.</p>}
        </>}
      </div>
      <footer className="thread-footer"><button className="secondary-btn" onClick={onClose}>Cerrar</button></footer>
    </section>
  </div>;
}

function ThreadRow({ node, onNavigate }: { node: ThreadNode; onNavigate: () => void }) {
  const status = statusLabels[node.status || ""] || node.status;
  return <li className={`thread-item ${node.voided ? "voided" : ""} ${node.root ? "current" : ""}`} data-group={node.group}>
    <span className="thread-date">{day(node.date)}</span>
    <span className="thread-dot" aria-hidden="true" />
    <div className="thread-card">
      <div className="thread-line">
        <span className="thread-type">{node.type}</span>
        <Link href={node.href} className="thread-number" onClick={onNavigate}>{node.number || "Sin número"} <ExternalLink size={12} /></Link>
        {node.root && <span className="thread-here">Estás acá</span>}
        {status && <span className={`badge ${node.status || ""}`}>{status}</span>}
        {node.amountCents !== undefined && node.amountCents !== 0 && <span className="thread-amount">{money(node.amountCents)}</span>}
      </div>
      {(node.title || node.userName) && <p className="thread-meta">{[node.title, node.userName && `cargó ${node.userName}`].filter(Boolean).join(" · ")}</p>}
      {node.events.map((event, index) => <p key={index} className="thread-event">{event.label} el {day(event.at)}{event.userName ? ` por ${event.userName}` : ""}</p>)}
    </div>
  </li>;
}
