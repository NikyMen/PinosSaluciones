"use client";

import { useSyncExternalStore } from "react";
import type { PriceRow } from "./price-lists";

/*
 * El pedido que se va armando desde el buscador de precios, antes de cerrar la
 * orden de compra. Es un borrador de quien lo arma: vive en el navegador para
 * que no se pierda al cambiar de pantalla o recargar. Los precios que guarda
 * son sólo para mostrar; al cerrar la orden el servidor los vuelve a sacar de
 * la lista vigente.
 */

export type CartLine = {
  itemId: string; supplierId: string; supplierName: string; discountPct: number;
  code: string; name: string; presentation: string; minSale: string;
  /** Sin IVA, al momento de agregarlo. */ listCents: number; ownCents: number;
  quantity: number;
};

const KEY = "pino.pedido-de-compra";
const EMPTY: CartLine[] = [];
const listeners = new Set<() => void>();
let cache: CartLine[] | null = null;

function isLine(value: unknown): value is CartLine {
  const line = value as CartLine;
  return Boolean(line) && typeof line.itemId === "string" && typeof line.supplierId === "string" && typeof line.name === "string" && Number(line.quantity) > 0;
}

function read(): CartLine[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || "[]");
    cache = Array.isArray(parsed) ? parsed.filter(isLine) : [];
  } catch { cache = []; }
  return cache;
}

function write(next: CartLine[]) {
  cache = next;
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sin almacenamiento, el pedido dura lo que la pestaña */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Otra pestaña cambió el pedido: se vuelve a leer.
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) { cache = null; listener(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

export const purchaseCart = {
  add(row: PriceRow, quantity = 1) {
    const lines = read();
    const existing = lines.find(line => line.itemId === row._id);
    if (existing) return write(lines.map(line => line === existing ? { ...line, quantity: line.quantity + quantity } : line));
    write([...lines, {
      itemId: row._id, supplierId: row.supplierId, supplierName: row.supplierName, discountPct: row.discountPct,
      code: row.code, name: row.name, presentation: row.presentation, minSale: row.minSale,
      listCents: row.listCents, ownCents: row.ownCents, quantity,
    }]);
  },
  setQuantity(itemId: string, quantity: number) {
    if (!(quantity > 0)) return purchaseCart.remove(itemId);
    write(read().map(line => line.itemId === itemId ? { ...line, quantity } : line));
  },
  remove(itemId: string) { write(read().filter(line => line.itemId !== itemId)); },
  /** Después de cerrar la orden de un proveedor, sus productos salen del pedido. */
  clearSupplier(supplierId: string) { write(read().filter(line => line.supplierId !== supplierId)); },
};

/** El pedido actual. En el servidor (y en el primer render) está vacío. */
export function usePurchaseCart() {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
