import type { Types } from "mongoose";
import { nextPurchaseNumber, Purchase, Quote, StockItem, StockReservation, Work } from "./models";
import { levelsOf } from "./stock-levels";
import { ownersOf, ownerTotals, type OwnerSplit } from "./stock-owners";
import { notify } from "./notifications";
import type { Session } from "./auth";

/*
 * Cotización, stock y abastecimiento (puntos 4 y 4.2 de la especificación):
 * - mientras se cotiza se consulta el stock y se informa lo que falta, sin reservar;
 * - al aprobar la cotización se reserva lo disponible y lo que falta genera un
 *   requerimiento de abastecimiento (una solicitud de compra) con aviso a Compras;
 * - si la cotización se cae, la reserva se libera; las salidas a su obra la consumen.
 * La prioridad entre reservas es por orden de aprobación (la regla fina está pendiente de definir).
 */

type Lean = Record<string, unknown> & { _id: Types.ObjectId };
type Insumo = { rubro?: string; code?: string; name?: string; unit?: string; coefPerUnit?: number; unitPriceCents?: number; stockItemId?: Types.ObjectId };
type QuoteDoc = Lean & { number?: string; title?: string; company?: string; status?: string; workId?: Types.ObjectId; items?: Array<{ qty?: number; composition?: Insumo[] }> };

export type Need = { key: string; stockItemId?: string; name: string; unit: string; neededQty: number; unitPriceCents: number };
export type Availability = Need & {
  matched: boolean; physicalQty: number; centralQty: number; salonQty: number; transitQty: number; reservedQty: number;
  /** Lo reservado por esta misma cotización (una vez aprobada). */ ownReservedQty: number;
  availableQty: number; shortageQty: number; owners: OwnerSplit;
};

const round = (value: number) => Math.round(value * 1000) / 1000;
const normalize = (text: unknown) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Lo que pide la cotización en materiales: cantidad del ítem por el coeficiente de cada insumo. Mano de obra y equipos no van. */
export function quoteNeeds(quote: QuoteDoc): Need[] {
  const needs = new Map<string, Need>();
  for (const item of quote.items || []) {
    for (const insumo of item.composition || []) {
      if ((insumo.rubro || "MAT") !== "MAT" || !insumo.name) continue;
      const quantity = round(Number(item.qty || 0) * Number(insumo.coefPerUnit || 0));
      if (quantity <= 0) continue;
      const key = insumo.stockItemId ? `id:${insumo.stockItemId}` : insumo.code ? `code:${normalize(insumo.code)}` : `name:${normalize(insumo.name)}`;
      const current = needs.get(key);
      if (current) current.neededQty = round(current.neededQty + quantity);
      else needs.set(key, { key, stockItemId: insumo.stockItemId ? String(insumo.stockItemId) : undefined, name: String(insumo.name), unit: String(insumo.unit || "u"), neededQty: quantity, unitPriceCents: Number(insumo.unitPriceCents || 0) });
    }
  }
  return [...needs.values()];
}

/**
 * Busca cada material en el stock: por el vínculo del insumo, por el código
 * interno o, si no, por el nombre exacto. Lo que no se encuentra no tiene stock.
 */
async function matchStock(needs: Need[]) {
  const ids = needs.map(need => need.stockItemId).filter(Boolean);
  const candidates = await StockItem.find({ $or: [{ _id: { $in: ids } }, { active: { $ne: false } }] }).select("name sku unit quantity qty_central qty_salon transitQty reservedQty owners").lean<Lean[]>();
  const byId = new Map(candidates.map(item => [String(item._id), item]));
  const bySku = new Map(candidates.filter(item => item.sku).map(item => [normalize(item.sku), item]));
  const byName = new Map(candidates.map(item => [normalize(item.name), item]));
  return needs.map(need => {
    const item = (need.stockItemId && byId.get(need.stockItemId))
      || (need.key.startsWith("code:") && bySku.get(need.key.slice(5)))
      || byName.get(normalize(need.name)) || null;
    return { need, item: item || null };
  });
}

/** Disponibilidad de los materiales de una cotización: físico, reservado, en tránsito, disponible y faltante, por empresa y por depósito. */
export async function quoteAvailability(quoteId: string): Promise<Availability[]> {
  const quote = await Quote.findById(quoteId).select("items status").lean<QuoteDoc>();
  if (!quote) return [];
  const own = await StockReservation.find({ quoteId, status: "activa" }).lean<Array<{ stockItemId: Types.ObjectId; quantity: number; consumedQty: number }>>();
  const ownByItem = new Map<string, number>();
  for (const reservation of own) ownByItem.set(String(reservation.stockItemId), round((ownByItem.get(String(reservation.stockItemId)) || 0) + reservation.quantity - reservation.consumedQty));
  const matched = await matchStock(quoteNeeds(quote));
  return matched.map(({ need, item }) => {
    if (!item) return { ...need, matched: false, physicalQty: 0, centralQty: 0, salonQty: 0, transitQty: 0, reservedQty: 0, ownReservedQty: 0, availableQty: 0, shortageQty: need.neededQty, owners: {} };
    const levels = levelsOf(item);
    const physical = round(levels.central + levels.salon);
    const ownReserved = ownByItem.get(String(item._id)) || 0;
    // Lo reservado por otras cotizaciones no está disponible; lo de esta misma, sí (es para ella).
    const othersReserved = round(Math.max(0, Number(item.reservedQty || 0) - ownReserved));
    const available = round(Math.max(0, physical - othersReserved));
    return {
      ...need, stockItemId: String(item._id), matched: true, physicalQty: physical, centralQty: levels.central, salonQty: levels.salon,
      transitQty: Number(item.transitQty || 0), reservedQty: othersReserved, ownReservedQty: ownReserved, availableQty: available,
      shortageQty: round(Math.max(0, need.neededQty - available)), owners: ownerTotals(ownersOf(item)),
    };
  });
}

/**
 * Al aprobar: reserva lo disponible, calcula el faltante (necesidad − reserva)
 * y, si falta algo, deja una solicitud de compra atada a la cotización y a la
 * obra con aviso a Compras. Si la cotización ya tiene reservas, no repite.
 */
export async function reserveForQuote(quoteId: string, session: Session) {
  if (await StockReservation.exists({ quoteId, status: "activa" })) return null;
  const quote = await Quote.findById(quoteId).lean<QuoteDoc>();
  if (!quote) return null;
  const availability = await quoteAvailability(quoteId);
  if (!availability.length) return null;
  const work = await Work.findOne({ quoteId }).select("_id startDate").lean<{ _id: Types.ObjectId; startDate?: Date }>();

  const lines: Array<{ stockItemId?: string; name: string; unit: string; neededQty: number; reservedQty: number; shortageQty: number; unitPriceCents: number }> = [];
  for (const row of availability) {
    let reserved = 0;
    if (row.matched && row.stockItemId) {
      reserved = round(Math.min(row.neededQty, row.availableQty));
      if (reserved > 0) {
        await StockReservation.create({ stockItemId: row.stockItemId, quoteId, workId: work?._id, quantity: reserved, userName: session.name });
        await StockItem.updateOne({ _id: row.stockItemId }, { $inc: { reservedQty: reserved } });
      }
    }
    lines.push({ stockItemId: row.stockItemId, name: row.name, unit: row.unit, neededQty: row.neededQty, reservedQty: reserved, shortageQty: round(row.neededQty - reserved), unitPriceCents: row.unitPriceCents });
  }

  const short = lines.filter(line => line.shortageQty > 0);
  let purchase: Lean | null = null;
  if (short.length) {
    purchase = (await Purchase.create({
      number: await nextPurchaseNumber(), company: quote.company || "tvp", quoteId: quote._id, workId: work?._id,
      description: `Faltante de materiales para ${quote.number} — ${quote.title}: ${short.map(line => `${line.shortageQty} ${line.unit} de ${line.name}`).join("; ")}`,
      amountCents: Math.round(short.reduce((total, line) => total + line.shortageQty * line.unitPriceCents, 0)),
      stage: "solicitud", status: "borrador", priority: "alta", requestedDate: new Date(), neededBy: work?.startDate,
      requestLines: lines.map(line => ({ stockItemId: line.stockItemId, name: line.name, unit: line.unit, neededQty: line.neededQty, reservedQty: line.reservedQty, shortageQty: line.shortageQty })),
      userId: session.userId, userName: session.name,
    })).toObject() as Lean;
    await notify({
      title: `Faltan materiales para ${quote.number}`,
      body: `Se aprobó "${quote.title}". Se reservó lo que había y quedó la solicitud ${String(purchase.number)} con ${short.length} ${short.length === 1 ? "material" : "materiales"} para comprar.`,
      kind: "stock", href: "/app/purchases", roles: ["compras"], dedupeKey: `quote-shortage-${quote._id}`,
    });
  }
  const reservedCount = lines.filter(line => line.reservedQty > 0).length;
  await Quote.updateOne({ _id: quote._id }, { $push: { history: { action: "Reserva de stock", note: `${reservedCount} ${reservedCount === 1 ? "material reservado" : "materiales reservados"}${short.length ? `; faltante en la solicitud ${String(purchase?.number)}` : "; no falta nada"}`, at: new Date(), userId: session.userId, userName: session.name } } });
  return { lines, purchase };
}

/** La cotización se cayó (rechazada, vencida, vuelta a borrador): lo reservado y no entregado vuelve a estar disponible. */
export async function releaseForQuote(quoteId: string, session: Session) {
  const active = await StockReservation.find({ quoteId, status: "activa" });
  if (!active.length) return 0;
  for (const reservation of active) {
    const open = round(reservation.quantity - reservation.consumedQty);
    reservation.status = "liberada";
    await reservation.save();
    if (open > 0) {
      const item = await StockItem.findById(reservation.stockItemId).select("reservedQty");
      if (item) { item.reservedQty = round(Math.max(0, Number(item.reservedQty || 0) - open)); await item.save(); }
    }
  }
  await Quote.updateOne({ _id: quoteId }, { $push: { history: { action: "Reserva liberada", note: `${active.length} ${active.length === 1 ? "reserva" : "reservas"} de stock`, at: new Date(), userId: session.userId, userName: session.name } } });
  return active.length;
}
