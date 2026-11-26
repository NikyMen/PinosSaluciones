"use client";

import { useEffect, useState } from "react";
import { History, X } from "lucide-react";
import type { Entity } from "@/lib/constants";
import { entityConfig } from "@/lib/entity-config";
import { date, dateTime, money, qty, titleCase } from "@/lib/format";
import { ownerLabels, type OwnerKey } from "@/lib/stock-owners";
import { warehouseLabel } from "@/lib/warehouses";

export type AuditEntry = { _id: string; action: string; userName?: string; userEmail?: string; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; createdAt?: string };

// items/overheads/cascade son la composición del costeo: cambian casi siempre juntos y
// listarlos campo por campo sería ruido, no trazabilidad. El resumen sale de amountCents
// y estimatedCostCents, que sí se comparan abajo y ya cuentan la historia que importa.
const ignored = new Set(["_id", "__v", "createdAt", "updatedAt", "history", "activity", "checklist", "advances", "certificates", "labor", "items", "overheads", "cascade"]);

type Movement = { kind?: string; quantity?: number; warehouse?: string; toWarehouse?: string; remito?: string; destinationLabel?: string; reference?: string; note?: string };

const movementLabels: Record<string, string> = { ingreso: "Entrada", egreso: "Salida", transferencia: "Transferencia", recepcion: "Recepción", ajuste: "Ajuste", venta: "Venta", devolucion: "Devolución", no_utilizable: "No utilizable", envio: "Envío por transporte", envio_anulado: "Envío anulado", ingreso_anulado: "Compra anulada" };
const locationLabel = (key: string) => key === "transito" ? "En tránsito" : warehouseLabel(key);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Un movimiento de stock en una línea: "Salida de 2 del Salón de Ventas a Obra X · remito R-12". */
function movementText(movement: Movement) {
  const kind = movementLabels[movement.kind || ""] || "Movimiento";
  const from = movement.warehouse ? ` ${movement.kind === "ingreso" || movement.kind === "recepcion" ? "al" : "del"} ${warehouseLabel(movement.warehouse)}` : "";
  const to = movement.toWarehouse ? ` al ${warehouseLabel(movement.toWarehouse)}` : movement.destinationLabel ? ` a ${movement.destinationLabel}` : "";
  const extra = [movement.remito && `remito ${movement.remito}`, movement.reference, movement.note].filter(Boolean).join(" · ");
  return `${kind} de ${qty(Number(movement.quantity || 0))}${from}${to}${extra ? ` · ${extra}` : ""}`;
}

/** De quién es lo que hay en cada depósito: "Salón de Ventas: Constructora Pino 13". */
function ownersText(value: Record<string, unknown>) {
  const parts = Object.entries(value).flatMap(([location, split]) => {
    if (!isRecord(split)) return [];
    const owners = Object.entries(split).filter(([, amount]) => Number(amount)).map(([owner, amount]) => `${ownerLabels[owner as OwnerKey] || owner} ${qty(Number(amount))}`);
    return owners.length ? [`${locationLabel(location)}: ${owners.join(", ")}`] : [];
  });
  return parts.length ? parts.join(" · ") : "vacío";
}

/** Lo que no es un valor simple, en palabras: nunca "[object Object]". */
function described(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.map(described).join(", ") : "vacío";
  if (isRecord(value)) {
    const name = value.name || value.label || value.number || value.title;
    if (name) return String(name);
    const parts = Object.entries(value).filter(([key, entry]) => !key.startsWith("_") && entry !== null && entry !== undefined && entry !== "" && !isRecord(entry) && !Array.isArray(entry));
    return parts.length ? parts.map(([key, entry]) => `${key}: ${String(entry)}`).join(" · ") : "…";
  }
  return String(value);
}

/** Muestra el valor de un campo como lo ve el usuario, no como lo guarda Mongo. */
function readable(entity: Entity, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return "vacío";
  if (key === "owners" && isRecord(value)) return ownersText(value);
  if (key === "movements" && Array.isArray(value)) return value.length ? `${value.length} movimiento${value.length === 1 ? "" : "s"}` : "vacío";
  if (Array.isArray(value) || isRecord(value)) return described(value);
  if (key.endsWith("Cents")) return money(Number(value));
  if (key === "progress") return `${value}%`;
  if (key.toLowerCase().includes("date") || key === "validUntil") return date(String(value));
  const field = entityConfig[entity].fields.find(candidate => candidate.key === key);
  if (field?.type === "select") return titleCase(String(value));
  if (key.endsWith("Id")) return "otro registro";
  return String(value);
}

const extraLabels: Record<string, string> = { movements: "Movimientos", owners: "Empresa dueña" };

function fieldLabel(entity: Entity, key: string) {
  const label = entityConfig[entity].fields.find(field => field.key === key)?.label || extraLabels[key];
  if (label) return label;
  // Cantidad y mínimo por depósito (qty_salon, min_central…): src/lib/models.ts.
  const perWarehouse = /^(qty|min)_(.+)$/.exec(key);
  if (perWarehouse) return `${perWarehouse[1] === "qty" ? "Cantidad en" : "Mínimo en"} ${locationLabel(perWarehouse[2])}`;
  return key;
}

/** Lista de cambios "campo: antes → después" de una entrada de auditoría. */
export function changes(entity: Entity, entry: AuditEntry) {
  const { before, after } = entry;
  if (!after) return [];
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after)])].filter(key => !ignored.has(key));
  return keys
    .filter(key => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map(key => {
      const change = { key, label: fieldLabel(entity, key), from: readable(entity, key, before?.[key]), to: readable(entity, key, after[key]) };
      // De los movimientos importa el que se sumó: "Salida de 2 del Salón de Ventas · remito R-12".
      if (key === "movements" && Array.isArray(after[key])) {
        const previous = Array.isArray(before?.[key]) ? (before[key] as unknown[]) : [];
        const seen = new Set(previous.map(movement => JSON.stringify(movement)));
        const added = (after[key] as Movement[]).filter(movement => !seen.has(JSON.stringify(movement)));
        if (added.length) return { ...change, label: added.length === 1 ? "Movimiento nuevo" : "Movimientos nuevos", from: change.from, to: added.map(movementText).join(" · ") };
      }
      return change;
    });
}

function headline(entity: Entity, entry: AuditEntry) {
  if (entry.action === "convert_to_work") return "Convirtió la cotización en obra";
  if (entry.action === "price_list_import") return `Subió la lista de precios vigente desde el ${date(String(entry.after?.validFrom || ""))} · ${Number(entry.after?.itemCount || 0)} productos`;
  if (entry.action === "edit_cascada" || entry.action === "edit_cascada_forzado") {
    const prefix = entry.action === "edit_cascada_forzado" ? "Destrabó y guardó el costeo" : "Guardó el costeo";
    const price = readable(entity, "amountCents", entry.after?.amountCents);
    return `${prefix} · precio ${price}`;
  }
  if (!entry.before && entry.after) return `Creó ${entityConfig[entity].singular === "cotización" ? "la" : "el"} ${entityConfig[entity].singular}`;
  if (!entry.after) return "Eliminó el registro";
  const list = changes(entity, entry);
  if (!list.length) return "Guardó sin cambios";
  return `Modificó ${list.map(change => change.label.toLowerCase()).slice(0, 3).join(", ")}${list.length > 3 ? ` y ${list.length - 3} campo(s) más` : ""}`;
}

/** Panel de trazabilidad reutilizable: quién, cuándo, y de qué valor a qué valor. */
export function RecordHistory({ entity, recordId, embedded = false, showHeading = true }: { entity: Entity; recordId: string; embedded?: boolean; showHeading?: boolean }) {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/audit?entity=${entity}&entityId=${encodeURIComponent(recordId)}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json() as { items?: AuditEntry[]; error?: string };
        if (!response.ok) throw new Error(result.error || "No se pudo cargar el historial");
        return result.items || [];
      })
      .then(setItems)
      .catch(problem => { if (!(problem instanceof DOMException && problem.name === "AbortError")) setError(problem instanceof Error ? problem.message : "No se pudo cargar el historial"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [entity, recordId]);

  return <section className={embedded ? "record-history embedded" : "record-history"}>
    {showHeading && <div className="task-form-heading"><div><p className="eyebrow">TRAZABILIDAD</p><h3>Historial de cambios</h3></div><span>Usuario · fecha y hora · valor anterior</span></div>}
    {loading ? <p className="task-history-state">Cargando historial…</p>
      : error ? <p className="task-history-state error-text">{error}</p>
      : !items.length ? <p className="task-history-state">Todavía no hay movimientos registrados.</p>
      : <ol className="history-timeline">{items.map(entry => {
        const list = changes(entity, entry);
        return <li key={entry._id}>
          <span className="task-history-marker" />
          <div>
            <strong>{headline(entity, entry)}</strong>
            <small>{entry.userName || "Usuario"}{entry.userEmail ? ` · ${entry.userEmail}` : ""} · {dateTime(entry.createdAt)}</small>
            {entry.before && list.length > 0 && <ul className="history-diff">{list.map(change => <li key={change.key}>
              <span className="diff-field">{change.label}</span>
              <span className="diff-from">{change.from}</span>
              <span className="diff-arrow">→</span>
              <span className="diff-to">{change.to}</span>
            </li>)}</ul>}
          </div>
        </li>;
      })}</ol>}
  </section>;
}

/** El mismo historial, pero en su propia ventana (el botón de las tablas). */
export function HistoryModal({ entity, record, onClose }: { entity: Entity; record: { _id: string; label: string }; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal history-modal" role="dialog" aria-modal="true" aria-labelledby="history-modal-title">
      <header>
        <div className="modal-title-wrap"><span className="modal-heading-icon"><History /></span><div>
          <p className="eyebrow">TRAZABILIDAD</p>
          <h2 id="history-modal-title">Historial de {record.label}</h2>
          <small>Cada creación y modificación, con usuario, hora y valor anterior</small>
        </div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button>
      </header>
      <div className="modal-form-body"><RecordHistory entity={entity} recordId={record._id} embedded showHeading={false} /></div>
      <footer><span>Se muestran los últimos 30 movimientos.</span><button type="button" className="secondary-btn" onClick={onClose}>Cerrar</button></footer>
    </section>
  </div>;
}
