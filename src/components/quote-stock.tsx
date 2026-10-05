"use client";

import { useEffect, useState } from "react";
import { PackageSearch } from "lucide-react";
import { qty } from "@/lib/format";
import { ownerLabels, type OwnerKey } from "@/lib/stock-owners";
import type { Availability } from "@/lib/reservations";

/**
 * Stock para esta cotización: mientras se cotiza muestra qué hay y qué falta,
 * sin reservar (se puede cotizar aunque no alcance). Aprobada, muestra lo que
 * quedó reservado para ella.
 */
export function QuoteStock({ quoteId, status }: { quoteId: string; status?: string }) {
  const [rows, setRows] = useState<Availability[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/quotes/${quoteId}/stock`, { signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudo consultar el stock"); return body.items as Availability[]; })
      .then(setRows)
      .catch(problem => { if (!controller.signal.aborted) { setRows([]); setError(problem instanceof Error ? problem.message : "No se pudo consultar el stock"); } });
    return () => controller.abort();
  }, [quoteId, status]);

  if (rows !== null && !rows.length && !error) return null;
  const approved = status === "aprobada" || status === "convertida";
  const short = (rows || []).filter(row => row.shortageQty > 0);

  return <section className="panel quote-stock">
    <div className="panel-head"><div><h2><PackageSearch size={17} /> Stock para esta cotización</h2>
      <p>{approved ? "Aprobada: lo disponible quedó reservado y el faltante pasó a Compras como solicitud." : "Solo consulta: no reserva nada. Al aprobarla se reserva lo disponible y el faltante le llega a Compras."}</p></div>
      {rows && <span className={short.length ? "badge pendiente" : "badge activo"}>{short.length ? `Faltan ${short.length}` : "Alcanza todo"}</span>}</div>
    {error && <p className="form-error">{error}</p>}
    {rows === null ? <div className="loading-state">Consultando…</div> : <div className="table-scroll"><table><thead><tr>
      <th>Material</th><th>Necesidad</th><th>Central</th><th>Salón</th><th>En tránsito</th><th>Reservado (otras)</th>{approved && <th>Reservado (esta)</th>}<th>Disponible</th><th>Faltante</th><th>Propietario</th>
    </tr></thead><tbody>{rows.map(row => <tr key={row.key} className={row.shortageQty > 0 ? "row-alert" : ""}>
      <td data-label="Material">{row.name}{!row.matched && <small className="tracking-sub">No está en el stock</small>}</td>
      <td data-label="Necesidad">{qty(row.neededQty)} {row.unit}</td>
      <td data-label="Central">{row.matched ? qty(row.centralQty) : "—"}</td>
      <td data-label="Salón">{row.matched ? qty(row.salonQty) : "—"}</td>
      <td data-label="En tránsito">{row.transitQty ? qty(row.transitQty) : "—"}</td>
      <td data-label="Reservado (otras)">{row.reservedQty ? qty(row.reservedQty) : "—"}</td>
      {approved && <td data-label="Reservado (esta)">{row.ownReservedQty ? qty(row.ownReservedQty) : "—"}</td>}
      <td data-label="Disponible">{row.matched ? qty(row.availableQty) : "—"}</td>
      <td data-label="Faltante">{row.shortageQty > 0 ? <b className="below">{qty(row.shortageQty)} {row.unit}</b> : "—"}</td>
      <td data-label="Propietario">{(Object.entries(row.owners) as Array<[OwnerKey, number]>).filter(([, value]) => value > 0).map(([owner, value]) => `${ownerLabels[owner]} ${qty(value)}`).join(" · ") || "—"}</td>
    </tr>)}</tbody></table></div>}
  </section>;
}
