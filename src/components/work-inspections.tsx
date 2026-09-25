"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, ClipboardCheck, Plus, TriangleAlert } from "lucide-react";
import { date } from "@/lib/format";
import { rubroLabel, type InspectionAlert, type InspectionRubro } from "@/lib/inspections";

type InspectionRow = { _id: string; dayKey: string; rubro: InspectionRubro; status: "borrador" | "cerrada"; managerName?: string; alerts?: InspectionAlert[]; closedByName?: string; createdByName?: string };

/**
 * Las inspecciones de la obra: los borradores que quedaron a medio recorrer y
 * las cerradas, cada una con sus alertas. El avance físico en porcentaje se
 * sacó de la pantalla por pedido de la empresa; las inspecciones siguen
 * guardando la producción del día igual que antes.
 */
export function WorkInspections({ workId, canEdit }: { workId: string; canEdit: boolean }) {
  const [items, setItems] = useState<InspectionRow[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/works/${workId}/inspections`);
    const result = await response.json();
    if (!response.ok) return setError(result.error || "No se pudieron cargar las inspecciones");
    setItems(result.items || []); setError("");
  }, [workId]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const closed = items.filter(item => item.status === "cerrada");
  const drafts = items.filter(item => item.status === "borrador");

  return <section id="inspecciones" className="panel work-inspections">
    <div className="panel-head">
      <div className="section-title"><ClipboardCheck /><div><h2>Inspecciones de obra</h2><p>Cada recorrida con su checklist, sus fotos y las alertas que dejó.</p></div></div>
      {canEdit && <Link className="primary-btn" href={`/app/works/${workId}/inspections/new`}><Plus size={17} /> Nueva inspección</Link>}
    </div>
    {error && <div className="notice error">{error}</div>}
    <div className="inspection-history">
      {drafts.length > 0 && <div className="detail-list">{drafts.map(item => <InspectionLink key={item._id} workId={workId} item={item} />)}</div>}
      <div className="detail-list">{closed.map(item => <InspectionLink key={item._id} workId={workId} item={item} />)}</div>
      {!items.length && <div className="empty-state compact">Todavía no hay inspecciones.{canEdit ? " Tocá “Nueva inspección” para cargar la primera." : ""}</div>}
    </div>
  </section>;
}

function InspectionLink({ workId, item }: { workId: string; item: InspectionRow }) {
  const alerts = item.alerts?.length || 0;
  return <Link className="detail-row insp-history-row" href={`/app/works/${workId}/inspections/${item._id}`}>
    <b>{date(item.dayKey)}</b>
    <span>{rubroLabel(item.rubro)}{item.managerName ? ` · ${item.managerName}` : ""}</span>
    {item.status === "borrador"
      ? <span className="badge pendiente">Borrador</span>
      : alerts > 0 ? <em className="insp-alert-count" title={item.alerts?.map(alert => alert.message).join("\n")}><TriangleAlert size={13} /> {alerts} {alerts === 1 ? "alerta" : "alertas"}</em> : <em className="insp-alert-count ok">Sin alertas</em>}
    <ChevronRight size={15} />
  </Link>;
}
