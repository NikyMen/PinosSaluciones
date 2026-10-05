"use client";

import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { qty } from "@/lib/format";
import { levelsOf } from "@/lib/stock-levels";
import { warehouseLabel, type WarehouseKey } from "@/lib/warehouses";

export type PickedItem = { _id: string; name: string; unit: string; sku?: string; avgCostCents?: number; lastPriceCents?: number } & Record<string, unknown>;

/**
 * Busca un material del stock y muestra cuánto hay en el depósito que importa
 * (el Salón para vender, el origen para transferir). Los que no tienen nada
 * ahí se ven, pero no se pueden agregar.
 */
export function StockPicker({ warehouse, onPick, exclude = [] }: { warehouse: WarehouseKey; onPick: (item: PickedItem, available: number) => void; exclude?: string[] }) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<PickedItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/records/stock?limit=25&search=${encodeURIComponent(search)}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : { items: [] })
        .then(result => { setRows(result.items || []); setLoading(false); })
        .catch(() => { if (!controller.signal.aborted) { setRows([]); setLoading(false); } });
    }, search ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search]);

  return <div className="stock-picker">
    <div className="search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar material por nombre, código o código de barras…" aria-label="Buscar material" /></div>
    <ul>
      {loading && !rows.length && <li className="muted">Buscando…</li>}
      {!loading && !rows.length && <li className="muted">No hay materiales que coincidan.</li>}
      {rows.filter(row => !exclude.includes(row._id)).map(row => {
        const available = levelsOf(row)[warehouse] || 0;
        return <li key={row._id}>
          <span><b>{row.name}</b><small>{row.sku ? `${row.sku} · ` : ""}En {warehouseLabel(warehouse)}: {qty(available)} {row.unit}</small></span>
          <button type="button" className="secondary-btn" disabled={available <= 0} onClick={() => onPick(row, available)} title={available > 0 ? "Agregar" : `No hay en ${warehouseLabel(warehouse)}`}><Plus size={14} /> Agregar</button>
        </li>;
      })}
    </ul>
  </div>;
}
