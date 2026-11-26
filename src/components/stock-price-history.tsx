"use client";

import { useEffect, useState } from "react";
import { Tags, X } from "lucide-react";
import { dateTime, money } from "@/lib/format";

/*
 * El historial del precio de venta sin IVA de un material: de cuánto a cuánto,
 * quién lo cambió, cuándo y desde dónde (la ficha de Stock o el Mostrador).
 * Ver src/lib/sale-prices.ts.
 */

type PriceChange = { _id: string; previousCents?: number; salePriceCents?: number; source?: string; userName?: string; createdAt: string };

const sourceLabels: Record<string, string> = { stock: "Ficha de Stock", mostrador: "Mostrador", alta: "Alta del material", lista: "Lista del proveedor", importacion: "Importación" };

export function StockPriceHistory({ itemId, embedded = false }: { itemId: string; embedded?: boolean }) {
  const [items, setItems] = useState<PriceChange[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/stock/${itemId}/precio`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json() as { items?: PriceChange[]; error?: string };
        if (!response.ok) throw new Error(result.error || "No se pudo cargar el historial de precios");
        setItems(result.items || []);
      })
      .catch(problem => { if (!(problem instanceof DOMException && problem.name === "AbortError")) setError(problem instanceof Error ? problem.message : "No se pudo cargar el historial de precios"); });
    return () => controller.abort();
  }, [itemId]);

  return <section className={embedded ? "record-history embedded" : "record-history"}>
    {embedded && <div className="task-form-heading"><div><p className="eyebrow">PRECIO DE VENTA</p><h3>Historial de precios</h3></div><span>Sin IVA · usuario · fecha y hora</span></div>}
    {error ? <p className="task-history-state error-text">{error}</p>
      : !items ? <p className="task-history-state">Cargando historial…</p>
      : !items.length ? <p className="task-history-state">Todavía no se registraron cambios de precio.</p>
      : <div className="table-scroll"><table className="price-history-table"><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Antes</th><th>Ahora</th><th>Desde</th></tr></thead><tbody>
        {items.map(change => <tr key={change._id}>
          <td data-label="Fecha y hora">{dateTime(change.createdAt)}</td>
          <td data-label="Usuario">{change.userName || "—"}</td>
          <td data-label="Antes">{change.previousCents ? money(change.previousCents) : "Sin precio"}</td>
          <td data-label="Ahora"><b>{change.salePriceCents ? money(change.salePriceCents) : "Sin precio"}</b></td>
          <td data-label="Desde">{sourceLabels[String(change.source)] || "—"}</td>
        </tr>)}
      </tbody></table></div>}
  </section>;
}

/** El historial de precios en su propia ventana (el botón de la lista de Stock). */
export function StockPriceHistoryModal({ item, onClose }: { item: { _id: string; label: string; salePriceCents?: number }; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal history-modal" role="dialog" aria-modal="true" aria-labelledby="price-history-title">
      <header>
        <div className="modal-title-wrap"><span className="modal-heading-icon"><Tags /></span><div>
          <p className="eyebrow">PRECIO DE VENTA</p>
          <h2 id="price-history-title">Precios de {item.label}</h2>
          <small>Hoy: {item.salePriceCents ? `${money(item.salePriceCents)} sin IVA` : "sin precio de venta"} · cada cambio con usuario, fecha y hora</small>
        </div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button>
      </header>
      <div className="modal-form-body"><StockPriceHistory itemId={item._id} /></div>
      <footer><span>Los cambios de precio desde la ficha de Stock y desde el Mostrador.</span><button type="button" className="secondary-btn" onClick={onClose}>Cerrar</button></footer>
    </section>
  </div>;
}
