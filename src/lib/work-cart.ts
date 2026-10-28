"use client";

import { useSyncExternalStore } from "react";

/*
 * El carrito para salir a obra: desde la lista de Stock se van sumando los
 * materiales con su cantidad y después se hace una sola salida en la Caja, con
 * su comprobante y sus remitos. Es un borrador de quien lo arma: vive en el
 * navegador para que no se pierda al cambiar de pantalla o recargar. Lo que
 * guarda del material es para mostrar; la Caja vuelve a leer cuánto hay y el
 * servidor revisa que alcance antes de mover nada.
 */

/** Lo que hace falta del material para mostrarlo en la Caja sin volver a buscarlo. */
export type WorkCartItem = {
  _id: string; name: string; unit: string; sku?: string; barcode?: string; category?: string;
  quantity?: number; avgCostCents?: number; lastPriceCents?: number;
} & Record<string, unknown>;
export type WorkCartLine = { item: WorkCartItem; quantity: number };

const KEY = "pino.carrito-de-obra";
const EMPTY: WorkCartLine[] = [];
const listeners = new Set<() => void>();
let cache: WorkCartLine[] | null = null;
const round = (value: number) => Math.round(value * 1000) / 1000;

function isLine(value: unknown): value is WorkCartLine {
  const line = value as WorkCartLine;
  return Boolean(line?.item) && typeof line.item._id === "string" && typeof line.item.name === "string" && Number(line.quantity) > 0;
}

function read(): WorkCartLine[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || "[]");
    cache = Array.isArray(parsed) ? parsed.filter(isLine) : [];
  } catch { cache = []; }
  return cache;
}

function write(next: WorkCartLine[]) {
  cache = next;
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sin almacenamiento, el carrito dura lo que la pestaña */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Otra pestaña cambió el carrito: se vuelve a leer.
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) { cache = null; listener(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

/** Sólo lo que usa la Caja: la fila de la tabla trae mucho más (movimientos, dueños…). */
function slim(item: Record<string, unknown>): WorkCartItem {
  const keep = ["_id", "name", "unit", "sku", "barcode", "category", "quantity", "avgCostCents", "lastPriceCents"];
  return Object.fromEntries(Object.entries(item).filter(([key]) => keep.includes(key) || key.startsWith("qty_"))) as WorkCartItem;
}

export const workCart = {
  add(item: Record<string, unknown>, quantity = 1) {
    const lines = read();
    const id = String(item._id);
    const existing = lines.find(line => line.item._id === id);
    if (existing) return write(lines.map(line => line === existing ? { item: slim(item), quantity: round(line.quantity + quantity) } : line));
    write([...lines, { item: slim(item), quantity: round(quantity) }]);
  },
  setQuantity(itemId: string, quantity: number) {
    if (!(quantity > 0)) return workCart.remove(itemId);
    write(read().map(line => line.item._id === itemId ? { ...line, quantity: round(quantity) } : line));
  },
  remove(itemId: string) { write(read().filter(line => line.item._id !== itemId)); },
  clear() { write([]); },
  /** Lo que hay ahora, fuera de React (la Caja lo lee una vez al abrir). */
  lines: () => read(),
};

/** El carrito actual. En el servidor (y en el primer render) está vacío. */
export function useWorkCart() {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
