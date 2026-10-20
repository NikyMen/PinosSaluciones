import type { Types } from "mongoose";
import { nextRequestNumber, PriceList, PriceListItem, Purchase, Quote, Supplier, Work } from "./models";
import { emitRequest } from "./purchase-flow";
import { discounted, normalize } from "./price-lists";
import { lineVatPct, purchaseTaxFields, type PurchaseTaxRates } from "./purchase-taxes";
import { purchaseOrderPdfData } from "./purchase-order-pdf";
import { qty, todayIso } from "./format";
import type { Session } from "./auth";

/*
 * Cerrar el pedido armado en el buscador de precios: una solicitud de compra
 * por proveedor, con los precios de su lista vigente y el descuento de hoy. Sale
 * emitida: por debajo del límite queda autorizada y nace la OC; desde el
 * límite espera la autorización. Cada renglón lleva su IVA (o el de la
 * solicitud) y sobre el neto van las percepciones y el impuesto interno: el
 * total sale de src/lib/purchase-taxes.ts. Los precios que trae el carrito del
 * navegador no se usan: pueden haber quedado viejos si entretanto llegó otra
 * lista o cambió el descuento.
 */

export class PurchaseOrderError extends Error {}

type StoredItem = {
  _id: Types.ObjectId; supplierId: Types.ObjectId; current?: boolean;
  code?: string; name: string; presentation?: string; minSale?: string; listPriceCents: number;
};

const productKey = (item: { code?: string; name: string; presentation?: string }) => `${normalize(item.code) || normalize(item.name)}|${normalize(item.presentation)}`;

export async function createPurchaseOrder({ company = "tvp", supplierId, lines, workId, requestedDate, expectedDate, deliverTo = "central", notes, paymentTerms = "contado", termDays, cashMethod, requiresAdvance = false, taxes = {}, session }: {
  company?: string; supplierId: string; lines: Array<{ itemId: string; quantity: number; vatPct?: number }>; workId?: string; requestedDate?: Date; expectedDate?: Date; deliverTo?: string; notes?: string;
  paymentTerms?: "contado" | "cuenta_corriente" | "plazo"; termDays?: number; cashMethod?: "efectivo" | "transferencia"; requiresAdvance?: boolean; taxes?: PurchaseTaxRates; session: Session;
}) {
  const supplier = await Supplier.findById(supplierId).lean() as ({ _id: Types.ObjectId; name: string; discountPct?: number } & Record<string, unknown>) | null;
  if (!supplier) throw new PurchaseOrderError("Proveedor no encontrado");
  const work = workId ? await Work.findById(workId).select("code name quoteId").lean() as ({ code?: string; name?: string; quoteId?: Types.ObjectId } & Record<string, unknown>) | null : null;
  if (workId && !work) throw new PurchaseOrderError("La obra elegida no existe");
  if (deliverTo === "obra" && !work) throw new PurchaseOrderError("Para entregar en la obra, elegí cuál");
  // La cotización de la obra va en la orden, como el "presupuesto asignado" de las órdenes de antes.
  const quote = work?.quoteId ? await Quote.findById(work.quoteId).select("number").lean() as { number?: string } | null : null;

  // El mismo producto agregado dos veces es un solo renglón, con la alícuota que se le haya puesto.
  const quantities = new Map<string, number>();
  const rates = new Map<string, number | undefined>();
  for (const line of lines) {
    quantities.set(line.itemId, (quantities.get(line.itemId) || 0) + line.quantity);
    if (line.vatPct !== undefined || !rates.has(line.itemId)) rates.set(line.itemId, line.vatPct);
  }

  const [stored, current] = await Promise.all([
    PriceListItem.find({ _id: { $in: [...quantities.keys()] } }).lean() as Promise<StoredItem[]>,
    PriceListItem.find({ supplierId, current: true }).lean() as Promise<StoredItem[]>,
  ]);
  const byId = new Map(stored.map(item => [String(item._id), item]));
  const currentByKey = new Map(current.map(item => [productKey(item), item]));

  const missing: string[] = [];
  const resolved: Array<{ item: StoredItem; quantity: number; vatPct?: number }> = [];
  for (const [itemId, quantity] of quantities) {
    const item = byId.get(itemId);
    if (!item || String(item.supplierId) !== supplierId) { missing.push("un producto que no es de este proveedor"); continue; }
    // Si desde que se agregó al pedido llegó otra lista, vale el precio de la vigente.
    const live = item.current ? item : currentByKey.get(productKey(item));
    if (!live) { missing.push(item.name); continue; }
    resolved.push({ item: live, quantity, vatPct: rates.get(itemId) });
  }
  if (missing.length) throw new PurchaseOrderError(`Estos productos ya no están en la lista vigente de ${supplier.name}: ${missing.join(", ")}. Sacalos del pedido y volvé a buscarlos.`);

  const discountPct = Number(supplier.discountPct || 0);
  const items = resolved.map(({ item, quantity, vatPct }) => {
    const unitCents = discounted(item.listPriceCents, discountPct);
    return {
      priceListItemId: item._id, code: item.code || "", name: item.name, presentation: item.presentation || "", minSale: item.minSale || "",
      quantity, listPriceCents: item.listPriceCents, discountPct, unitCents, totalCents: Math.round(unitCents * quantity),
      vatPct: lineVatPct({ vatPct }, taxes.vatPct),
    };
  });
  const list = await PriceList.findOne({ supplierId, current: true }).select("validFrom").lean() as { _id: Types.ObjectId; validFrom: Date } | null;

  const summary = items.slice(0, 3).map(item => `${qty(item.quantity)} x ${item.name}`).join(", ");
  const purchase = await Purchase.create({
    number: await nextRequestNumber(), company,
    supplierId, workId: work ? workId : undefined, quoteId: work?.quoteId,
    description: `${items.length} ${items.length === 1 ? "producto" : "productos"} de ${supplier.name}: ${summary}${items.length > 3 ? ` y ${items.length - 3} más` : ""}`,
    ...purchaseTaxFields(items, taxes), items, notes: notes || "",
    deliverTo, quoteNumber: quote?.number || undefined,
    paymentTerms, termDays: paymentTerms === "plazo" ? termDays : undefined, cashMethod: paymentTerms === "contado" ? cashMethod : undefined, requiresAdvance,
    stage: "solicitud", status: "borrador", history: [{ action: "Creada desde el buscador de precios", at: new Date(), userName: session.name }],
    requestedDate: requestedDate ?? new Date(`${todayIso()}T00:00:00.000Z`), expectedDate,
    priceListId: list?._id, priceListDate: list?.validFrom,
    userId: session.userId, userName: session.name,
  });
  // Se emite enseguida: el pedido del carrito ya está completo.
  const saved = await emitRequest(String(purchase._id), session) as unknown as Record<string, unknown>;
  return { purchase: saved, pdf: purchaseOrderPdfData(saved, supplier, work, quote?.number) };
}
