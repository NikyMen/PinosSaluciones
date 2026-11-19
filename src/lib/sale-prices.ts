import { isValidObjectId } from "mongoose";
import { StockItem, StockPriceChange } from "./models";
import { HttpError } from "./api";
import type { Session } from "./auth";

/*
 * El precio de venta sin IVA de cada material (`salePriceCents`) y su historial.
 * Se cambia desde la ficha de Stock o desde el Mostrador (botón Guardar), y cada
 * cambio deja quién, cuándo, desde dónde y de cuánto a cuánto
 * (colección `stockpricechanges`).
 */

export type PriceSource = "stock" | "mostrador" | "alta";

/** Anota un cambio del precio de venta. No hace nada si el precio quedó igual. */
export async function recordSalePriceChange(stockItemId: unknown, previous: unknown, next: unknown, session: Session, source: PriceSource) {
  // Cero o vacío es "sin precio".
  const cents = (value: unknown) => Number(value) > 0 ? Math.round(Number(value)) : undefined;
  const before = cents(previous);
  const after = cents(next);
  if (before === after) return null;
  return StockPriceChange.create({ stockItemId, previousCents: before, salePriceCents: after, source, userId: session.userId, userName: session.name });
}

/** Guarda el precio de venta de un material y lo anota en el historial. Devuelve el material. */
export async function setSalePrice(stockItemId: string, salePriceCents: number, session: Session, source: PriceSource) {
  if (!isValidObjectId(stockItemId)) throw new HttpError("Material no encontrado", 404);
  const cents = Math.round(salePriceCents);
  if (!Number.isFinite(cents) || cents <= 0) throw new HttpError("Poné un precio mayor a cero");
  const before = await StockItem.findById(stockItemId).select("name salePriceCents").lean<{ _id: unknown; name: string; salePriceCents?: number }>();
  if (!before) throw new HttpError("Material no encontrado", 404);
  await StockItem.updateOne({ _id: stockItemId }, { $set: { salePriceCents: cents } });
  await recordSalePriceChange(stockItemId, before.salePriceCents, cents, session, source);
  return { before, salePriceCents: cents };
}

/** Los cambios de precio de un material, el último primero. */
export async function salePriceHistory(stockItemId: string, limit = 100) {
  if (!isValidObjectId(stockItemId)) throw new HttpError("Material no encontrado", 404);
  return StockPriceChange.find({ stockItemId }).sort({ createdAt: -1 }).limit(limit).lean();
}
