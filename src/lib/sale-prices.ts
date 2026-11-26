import { isValidObjectId } from "mongoose";
import { PriceListItem, StockItem, StockPriceChange } from "./models";
import { HttpError } from "./api";
import { indexListItems, matchListItem, saleCentsFromGross, type ListPriceItem } from "./list-price-match";

/*
 * El precio de venta sin IVA de cada material (`salePriceCents`) y su historial.
 * Se cambia desde la ficha de Stock, desde el Mostrador (botón Guardar) o sale
 * de la lista del proveedor que trae el precio final al consumidor (Protex),
 * y cada cambio deja quién, cuándo, desde dónde y de cuánto a cuánto
 * (colección `stockpricechanges`).
 */

export type PriceSource = "stock" | "mostrador" | "alta" | "lista" | "importacion";
/** Quién hizo el cambio: el usuario o, si lo hizo el sistema, sólo un nombre. */
type Actor = { userId?: string; name: string };

/** Anota un cambio del precio de venta. No hace nada si el precio quedó igual. */
export async function recordSalePriceChange(stockItemId: unknown, previous: unknown, next: unknown, actor: Actor, source: PriceSource) {
  // Cero o vacío es "sin precio".
  const cents = (value: unknown) => Number(value) > 0 ? Math.round(Number(value)) : undefined;
  const before = cents(previous);
  const after = cents(next);
  if (before === after) return null;
  return StockPriceChange.create({ stockItemId, previousCents: before, salePriceCents: after, source, userId: actor.userId, userName: actor.name });
}

/** Guarda el precio de venta de un material y lo anota en el historial. Devuelve el material. */
export async function setSalePrice(stockItemId: string, salePriceCents: number, actor: Actor, source: PriceSource) {
  if (!isValidObjectId(stockItemId)) throw new HttpError("Material no encontrado", 404);
  const cents = Math.round(salePriceCents);
  if (!Number.isFinite(cents) || cents <= 0) throw new HttpError("Poné un precio mayor a cero");
  const before = await StockItem.findById(stockItemId).select("name salePriceCents").lean<{ _id: unknown; name: string; salePriceCents?: number }>();
  if (!before) throw new HttpError("Material no encontrado", 404);
  await StockItem.updateOne({ _id: stockItemId }, { $set: { salePriceCents: cents } });
  await recordSalePriceChange(stockItemId, before.salePriceCents, cents, actor, source);
  return { before, salePriceCents: cents };
}

/** Los cambios de precio de un material, el último primero. */
export async function salePriceHistory(stockItemId: string, limit = 100) {
  if (!isValidObjectId(stockItemId)) throw new HttpError("Material no encontrado", 404);
  return StockPriceChange.find({ stockItemId }).sort({ createdAt: -1 }).limit(limit).lean();
}

/** Los productos vigentes de las listas con precio final al consumidor (de un proveedor o de todos). */
export async function currentListItems(supplierId?: unknown) {
  return PriceListItem.find({ current: true, consumerGrossCents: { $gt: 0 }, ...(supplierId ? { supplierId } : {}) })
    .select("supplierId code name presentation consumerGrossCents").lean<ListPriceItem[]>();
}

/**
 * Pasa el precio final de la lista vigente al precio de venta de los materiales
 * de Stock que son de esa lista (ver list-price-match.ts). Se usa al cargar una
 * lista nueva y para la carga inicial (scripts/sale-prices-from-list.ts). Sin
 * `apply` sólo dice qué cambiaría.
 */
export async function applyListSalePrices({ supplierId, apply, actor }: { supplierId?: unknown; apply: boolean; actor: Actor }) {
  const byCode = indexListItems(await currentListItems(supplierId));
  const stock = await StockItem.find({ sku: { $nin: [null, ""] } }).select("name sku supplierId salePriceCents").lean<Array<{ _id: unknown; name: string; sku?: string; supplierId?: unknown; salePriceCents?: number }>>();
  const changes: Array<{ stockItemId: string; name: string; sku: string; listName: string; previousCents?: number; salePriceCents: number }> = [];
  for (const item of stock) {
    const listItem = matchListItem(item, byCode);
    if (!listItem) continue;
    const cents = saleCentsFromGross(Number(listItem.consumerGrossCents));
    if (cents === Number(item.salePriceCents || 0)) continue;
    changes.push({ stockItemId: String(item._id), name: item.name, sku: String(item.sku), listName: [listItem.name, listItem.presentation].filter(Boolean).join(" · "), previousCents: item.salePriceCents || undefined, salePriceCents: cents });
    if (apply) await setSalePrice(String(item._id), cents, actor, "lista");
  }
  return changes;
}
