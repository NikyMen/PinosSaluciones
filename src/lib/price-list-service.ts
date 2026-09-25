import { Types } from "mongoose";
import { PriceList, PriceListItem, Supplier } from "./models";
import {
  compareLists, discounted, escapeRegex, markBest, measureOf, normalize, relevance, searchTextOf, searchTokens, STALE_AFTER_DAYS, withoutVat,
  type Measure, type MeasureUnit, type ParsedPriceItem, type PriceLayout, type PriceRow,
} from "./price-lists";
import type { Session } from "./auth";

/*
 * Las listas de precios contra la base: importar una lista nueva, armar las
 * filas que ve la pantalla y buscar entre los productos de todas las listas
 * vigentes. Las cuentas en sí (leer el Excel, comparar, descontar) están en
 * price-lists.ts.
 */

type StoredItem = {
  _id: Types.ObjectId; supplierId: Types.ObjectId; priceListId: Types.ObjectId;
  code?: string; name: string; description?: string; presentation?: string; minSale?: string;
  category?: string; subcategory?: string; kind?: string;
  listPriceCents: number; previousPriceCents?: number | null; measureQty?: number | null; measureUnit?: string | null;
};
type StoredSupplier = { _id: Types.ObjectId; name: string; discountPct?: number; active?: boolean };
type StoredList = { _id: Types.ObjectId; validFrom: Date; legend?: Record<string, string> };

/** Los precios se guardan sin IVA: si la lista venía con IVA, se lo saca al importar. */
function netItems(items: ParsedPriceItem[], pricesIncludeVat: boolean) {
  return items.map(item => ({ ...item, listPriceCents: pricesIncludeVat ? withoutVat(item.listPriceCents) : item.listPriceCents }));
}

export async function currentList(supplierId: string) {
  return PriceList.findOne({ supplierId, current: true }).lean() as Promise<{ _id: Types.ObjectId; validFrom: Date; itemCount: number } | null>;
}

/** Qué cambiaría si se importa la lista: productos nuevos, cuáles suben, cuáles bajan. */
export async function previewImport(supplierId: string, items: ParsedPriceItem[], pricesIncludeVat: boolean) {
  const next = netItems(items, pricesIncludeVat);
  const previous = await PriceListItem.find({ supplierId, current: true }).select("code name presentation listPriceCents").lean() as StoredItem[];
  const { previous: prices, summary } = compareLists(previous, next);
  const changes = next
    .map((item, index) => ({ code: item.code, name: item.name, presentation: item.presentation, previousCents: prices[index], listCents: item.listPriceCents }))
    .filter((item): item is typeof item & { previousCents: number } => item.previousCents !== undefined && item.previousCents !== item.listCents)
    .sort((a, b) => Math.abs(b.listCents / b.previousCents - 1) - Math.abs(a.listCents / a.previousCents - 1))
    .slice(0, 8);
  const sample = next.slice(0, 6).map(item => ({ code: item.code, name: item.name, presentation: item.presentation, category: item.category, listCents: item.listPriceCents }));
  return { summary, changes, sample };
}

export class PriceListConflict extends Error {}

/** Subir por error una lista vieja no puede pisar los precios de la nueva. */
export async function assertNewest(supplierId: string, validFrom: Date) {
  const current = await currentList(supplierId);
  if (current && current.validFrom > validFrom) {
    const shown = current.validFrom.toISOString().slice(0, 10).split("-").reverse().join("/");
    throw new PriceListConflict(`Ya está cargada una lista más nueva, vigente desde el ${shown}. Revisá la fecha de vigencia.`);
  }
}

/**
 * Guarda la lista y la deja como vigente. La lista anterior y sus productos no
 * se borran: pasan a ser historia. El cambio de vigente se hace recién cuando
 * la lista nueva quedó guardada entera, así un corte a mitad de camino no deja
 * al proveedor sin precios.
 */
export async function saveImport({ supplierId, items, layout, legend, validFrom, pricesIncludeVat, fileName, file, session, rememberLayout }: {
  supplierId: string; items: ParsedPriceItem[]; layout: PriceLayout; legend: Record<string, string>;
  validFrom: Date; pricesIncludeVat: boolean; fileName: string; file: string; session: Session; rememberLayout: boolean;
}) {
  await assertNewest(supplierId, validFrom);
  const next = netItems(items, pricesIncludeVat);
  const previous = await PriceListItem.find({ supplierId, current: true }).select("code name presentation listPriceCents").lean() as StoredItem[];
  const { previous: prices, summary } = compareLists(previous, next);

  const list = await PriceList.create({
    supplierId, validFrom, fileName, file, sheet: layout.sheet, pricesIncludeVat, current: false,
    itemCount: next.length, summary, legend, userId: session.userId, userName: session.name,
  });
  try {
    await PriceListItem.insertMany(next.map((item, index) => {
      const measure = measureOf(item.presentation, item.minSale);
      return {
        ...item, supplierId, priceListId: list._id, current: false,
        previousPriceCents: prices[index] ?? null,
        measureQty: measure?.qty ?? null, measureUnit: measure?.unit ?? null,
        searchText: searchTextOf(item),
      };
    }), { ordered: true });
  } catch (error) {
    await PriceListItem.deleteMany({ priceListId: list._id });
    await PriceList.deleteOne({ _id: list._id });
    throw error;
  }

  await PriceListItem.updateMany({ supplierId, current: true }, { $set: { current: false } });
  await PriceList.updateMany({ supplierId, current: true }, { $set: { current: false } });
  await PriceListItem.updateMany({ priceListId: list._id }, { $set: { current: true } });
  list.current = true;
  await list.save();
  if (rememberLayout) await Supplier.updateOne({ _id: supplierId }, { $set: { priceFormat: layout } });
  return { list: list.toObject(), summary };
}

/** "Consultar disponibilidad antes de pedir - productos importados…" → "Consultar disponibilidad antes de pedir". */
const shortLegend = (text = "") => text.split(" - ")[0].trim();

async function toRows(items: StoredItem[]): Promise<PriceRow[]> {
  const supplierIds = [...new Set(items.map(item => String(item.supplierId)))];
  const listIds = [...new Set(items.map(item => String(item.priceListId)))];
  const [suppliers, lists] = await Promise.all([
    Supplier.find({ _id: { $in: supplierIds } }).select("name discountPct active").lean() as Promise<StoredSupplier[]>,
    PriceList.find({ _id: { $in: listIds } }).select("validFrom legend").lean() as Promise<StoredList[]>,
  ]);
  const supplierById = new Map(suppliers.map(supplier => [String(supplier._id), supplier]));
  const listById = new Map(lists.map(list => [String(list._id), list]));

  return items.flatMap(item => {
    const supplier = supplierById.get(String(item.supplierId));
    const list = listById.get(String(item.priceListId));
    if (!supplier || !list) return [];
    const discountPct = Number(supplier.discountPct || 0);
    const measure: Measure | null = item.measureQty && item.measureUnit ? { qty: item.measureQty, unit: item.measureUnit as MeasureUnit } : null;
    return [{
      _id: String(item._id), supplierId: String(supplier._id), supplierName: supplier.name, discountPct,
      listId: String(list._id), validFrom: new Date(list.validFrom).toISOString(),
      code: item.code || "", name: item.name, description: item.description || "", presentation: item.presentation || "", minSale: item.minSale || "",
      category: item.category || "", subcategory: item.subcategory || "", kind: item.kind || "",
      kindLabel: shortLegend(list.legend?.[item.kind || ""]),
      listCents: item.listPriceCents, ownCents: discounted(item.listPriceCents, discountPct),
      previousCents: typeof item.previousPriceCents === "number" ? item.previousPriceCents : null,
      measure,
      stale: Date.now() - new Date(list.validFrom).getTime() > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
    }];
  });
}

/** Busca en las listas vigentes de todos los proveedores activos. */
export async function searchPrices(query: string, limit = 80) {
  const tokens = searchTokens(query);
  if (!tokens.length) return { rows: [] as PriceRow[], total: 0 };
  const inactive = await Supplier.find({ active: false }).distinct("_id");
  const filter = {
    current: true,
    ...(inactive.length ? { supplierId: { $nin: inactive } } : {}),
    $and: tokens.map(token => ({ searchText: { $regex: escapeRegex(token) } })),
  };
  const [items, total] = await Promise.all([
    PriceListItem.find(filter).limit(500).lean() as Promise<StoredItem[]>,
    PriceListItem.countDocuments(filter),
  ]);
  const unitCost = (row: PriceRow) => row.measure ? row.ownCents / row.measure.qty : row.ownCents;
  const scored = (await toRows(items))
    .map(row => ({ row, score: relevance(row, tokens), name: normalize(row.name) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "es") || unitCost(a.row) - unitCost(b.row))
    .slice(0, limit);
  // El "mejor precio" se elige entre los que tienen lo buscado en el nombre; si
  // ninguno lo tiene (se buscó por descripción), entre todos.
  const byName = new Set(scored.filter(entry => entry.score > 1).map(entry => entry.row));
  const rows = scored.map(entry => entry.row);
  return { rows: markBest(rows, row => !byName.size || byName.has(row)), total };
}

/** La pantalla de un proveedor: sus datos, todas sus listas y los productos de la vigente. */
export async function supplierPrices(supplierId: string) {
  const supplier = await Supplier.findById(supplierId).select("name contactName phone email discountPct priceFormat").lean() as (StoredSupplier & { contactName?: string; phone?: string; email?: string; priceFormat?: PriceLayout }) | null;
  if (!supplier) return null;
  const [lists, items] = await Promise.all([
    PriceList.find({ supplierId }).sort({ validFrom: -1, createdAt: -1 }).limit(60).lean(),
    PriceListItem.find({ supplierId, current: true }).sort({ row: 1 }).lean() as Promise<StoredItem[]>,
  ]);
  return {
    supplier: { _id: String(supplier._id), name: supplier.name, contactName: supplier.contactName || "", phone: supplier.phone || "", email: supplier.email || "", discountPct: Number(supplier.discountPct || 0), hasSavedFormat: Boolean(supplier.priceFormat) },
    lists,
    items: await toRows(items),
  };
}

/** Cómo fue cambiando el precio de un producto, lista por lista. */
export async function priceHistory(itemId: string) {
  const item = await PriceListItem.findById(itemId).lean() as StoredItem | null;
  if (!item) return null;
  const sameProduct = item.code ? { code: item.code } : { name: item.name };
  const siblings = await PriceListItem.find({ supplierId: item.supplierId, ...sameProduct, presentation: item.presentation || "" }).select("priceListId listPriceCents current").lean() as Array<StoredItem & { current?: boolean }>;
  const lists = await PriceList.find({ _id: { $in: siblings.map(sibling => sibling.priceListId) } }).select("validFrom").lean() as StoredList[];
  const validFrom = new Map(lists.map(list => [String(list._id), list.validFrom]));
  return siblings
    .filter(sibling => validFrom.has(String(sibling.priceListId)))
    .map(sibling => ({ listId: String(sibling.priceListId), validFrom: new Date(validFrom.get(String(sibling.priceListId))!).toISOString(), listCents: sibling.listPriceCents, current: Boolean(sibling.current) }))
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
}
