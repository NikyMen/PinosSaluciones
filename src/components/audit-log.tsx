"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { dateTime } from "@/lib/format";
import { entityLabels, type Entity } from "@/lib/constants";

type Row = { _id: string; userName?: string; userEmail?: string; action: string; entity: string; entityId?: string; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; createdAt: string };

const actionLabels: Record<string, string> = {
  create: "Alta", update: "Cambio", delete: "Baja", status_change: "Cambio de estado", convert_to_work: "Pasó a obra", import: "Importación", restore: "Restauración", purge: "Borrado definitivo",
  stock_ingreso: "Entrada de stock", stock_egreso: "Salida a obra", stock_transferencia: "Transferencia", stock_recepcion: "Recepción", stock_venta: "Venta (remito)", stock_ajuste: "Ajuste de stock", purchase_to_stock: "Orden pasada a stock",
};
const extraEntities: Record<string, string> = { voucher_books: "Talonarios", users: "Usuarios", stock_transfers: "Transferencias", sales_remitos: "Remitos de venta" };
// Lo que cambia en cada guardado y no dice nada.
const noise = new Set(["updatedAt", "createdAt", "__v", "_id", "movements", "labor", "activity", "history", "accountHistory"]);

const entityName = (entity: string) => entityLabels[entity as Entity] || extraEntities[entity] || entity;

function short(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return Array.isArray(value) ? `${value.length} elementos` : "…";
  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** Qué campos cambiaron entre el antes y el después, con los dos valores. */
function changes(row: Row) {
  const before = row.before || {}; const after = row.after || {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !noise.has(key));
  return keys.filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).slice(0, 8)
    .map(key => ({ key, before: short(before[key]), after: short(after[key]) }));
}

/** La bitácora: usuario, fecha y hora, qué hizo, sobre qué registro y el valor anterior y el nuevo. */
export function AuditLogView() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [entities, setEntities] = useState<string[]>([]);
  const [entity, setEntity] = useState("");
  const [user, setUser] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ page: String(page), ...(entity ? { entity } : {}), ...(user ? { user } : {}) });
      fetch(`/api/audit/log?${query.toString()}`, { signal: controller.signal })
        .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudo leer la bitácora"); return body; })
        .then(body => { setRows(body.items); setEntities(body.entities || []); setPages(body.pagination?.pages || 1); setError(""); })
        .catch(problem => { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : "No se pudo leer la bitácora"); });
    }, user ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [entity, user, page]);

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">SEGURIDAD</p>
      <h1>Bitácora de cambios</h1>
      <p>Cada alta, cambio y baja: quién, cuándo, sobre qué registro y qué valor tenía antes y después.</p>
    </div></div>
    <div className="toolbar">
      <div className="search"><Search size={18} /><input value={user} onChange={event => { setUser(event.target.value); setPage(1); }} placeholder="Buscar por usuario…" /></div>
      <label className="toolbar-select"><span>Módulo</span><select value={entity} onChange={event => { setEntity(event.target.value); setPage(1); }}>
        <option value="">Todos</option>
        {entities.map(name => <option key={name} value={name}>{entityName(name)}</option>)}
      </select></label>
    </div>
    {error && <div className="notice error">{error}</div>}
    <section className="table-panel">
      {rows === null ? <div className="loading-state">Cargando…</div> : !rows.length ? <div className="empty-state"><p>No hay movimientos para mostrar.</p></div>
        : <div className="table-scroll"><table className="audit-table"><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Acción</th><th>Módulo</th><th>Qué cambió</th></tr></thead><tbody>
          {rows.map(row => {
            const diff = changes(row);
            return <tr key={row._id}>
              <td data-label="Fecha y hora">{dateTime(row.createdAt)}</td>
              <td data-label="Usuario">{row.userName || "—"}<small className="tracking-sub">{row.userEmail}</small></td>
              <td data-label="Acción"><span className="badge audit-action">{actionLabels[row.action] || row.action}</span></td>
              <td data-label="Módulo">{entityName(row.entity)}<small className="tracking-sub">{short(row.after?.number || row.after?.name || row.after?.title || row.before?.number || row.before?.name || row.before?.title || "")}</small></td>
              <td data-label="Qué cambió">{row.action !== "create" && row.action !== "delete" && row.action !== "import"
                ? diff.length ? <ul className="audit-diff">{diff.map(change => <li key={change.key}><b>{change.key}</b> {change.before} → {change.after}</li>)}</ul> : <span className="muted">Sin diferencias visibles</span>
                : <span className="muted">{row.action === "delete" ? "Registro eliminado" : row.action === "create" ? "Registro nuevo" : "—"}</span>}</td>
            </tr>;
          })}
        </tbody></table></div>}
    </section>
    {pages > 1 && <div className="pager"><button className="secondary-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {pages}</span><button className="secondary-btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Siguiente</button></div>}
  </>;
}
