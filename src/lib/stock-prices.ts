import type { Types } from "mongoose";
import { PriceList, PriceListItem, Supplier } from "./models";
import { discounted } from "./price-lists";

type StockRow = Record<string, unknown> & { supplierId?: unknown; sku?: unknown; movements?: Array<{ kind?: string; unitCostCents?: number; date?: Date | string; createdAt?: Date | string }> };
type PriceItem = { supplierId: Types.ObjectId; code?: string; listPriceCents: number; priceListId: Types.ObjectId };

/**
 * El último precio de cada material, con su fecha. Sale de la lista del
 * proveedor (el mismo código): el precio de la última lista que incluyó el
 * producto, con el descuento del proveedor y sin IVA. Si el material no está
 * en ninguna lista, vale el costo de su último ingreso.
 */
export async function withLastPrices<T extends StockRow>(items: T[]): Promise<Array<T & { lastPriceCents: number; lastPriceDate: string | null; lastPriceSource: "lista" | "compra" | null }>> {
  const linked = items.filter(item => item.supplierId && String(item.sku || "").trim());
  const prices = linked.length
    ? await PriceListItem.find({ current: true, $or: linked.map(item => ({ supplierId: item.supplierId, code: String(item.sku).trim() })) })
      .select("supplierId code listPriceCents priceListId").lean() as PriceItem[]
    : [];
  const [lists, suppliers] = await Promise.all([
    prices.length ? PriceList.find({ _id: { $in: prices.map(price => price.priceListId) } }).select("validFrom").lean() as Promise<Array<{ _id: Types.ObjectId; validFrom: Date }>> : [],
    prices.length ? Supplier.find({ _id: { $in: prices.map(price => price.supplierId) } }).select("discountPct").lean() as Promise<Array<{ _id: Types.ObjectId; discountPct?: number }>> : [],
  ]);
  const listDate = new Map(lists.map(list => [String(list._id), list.validFrom]));
  const discount = new Map(suppliers.map(supplier => [String(supplier._id), Number(supplier.discountPct || 0)]));
  const byKey = new Map(prices.map(price => [`${price.supplierId}|${String(price.code || "").toLowerCase()}`, price]));

  return items.map(item => {
    const price = item.supplierId ? byKey.get(`${item.supplierId}|${String(item.sku || "").trim().toLowerCase()}`) : undefined;
    const validFrom = price ? listDate.get(String(price.priceListId)) : undefined;
    if (price && validFrom) return { ...item, lastPriceCents: discounted(price.listPriceCents, discount.get(String(price.supplierId)) || 0), lastPriceDate: new Date(validFrom).toISOString(), lastPriceSource: "lista" as const };
    const purchase = [...(item.movements || [])].reverse().find(movement => movement.kind === "ingreso" && Number(movement.unitCostCents) > 0);
    if (purchase) return { ...item, lastPriceCents: Number(purchase.unitCostCents), lastPriceDate: new Date(purchase.date || purchase.createdAt || Date.now()).toISOString(), lastPriceSource: "compra" as const };
    return { ...item, lastPriceCents: 0, lastPriceDate: null, lastPriceSource: null };
  });
}
