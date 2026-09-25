import type { Types } from "mongoose";
import { Counter, Expense, Purchase, Quote, StockItem, Work } from "./models";
import { notify } from "./notifications";
import { money } from "./format";
import { levelsOf, lowWarehouses, qtyField, totalOf, type Levels } from "./stock-levels";
import { warehouseLabel, WAREHOUSES, type WarehouseKey } from "./warehouses";
import type { Session } from "./auth";

/*
 * Los movimientos de stock con depósitos. Es lo único que cambia cuánto hay de
 * un material:
 *
 * - entrada (una compra): suma al depósito donde entró y recalcula el costo
 *   promedio. Todavía no es costo de ninguna obra.
 * - salida a obra: resta de uno o de los dos depósitos (primero del Central y
 *   lo que falte del Salón), carga el costo a la obra y deja un remito por cada
 *   depósito. No es una venta: no hay factura.
 * - pase entre depósitos: resta de uno, suma al otro y deja su remito. No mueve
 *   plata ni cambia el costo.
 * - ajuste: fija lo que se contó en un depósito.
 */

export class StockError extends Error {}

type Doc = InstanceType<typeof StockItem> & Record<string, unknown> & {
  _id: Types.ObjectId; name: string; unit: string; sku?: string; quantity: number; avgCostCents: number; valueCents: number;
  movements: { push: (...items: unknown[]) => number };
  save: () => Promise<unknown>; toObject: () => Record<string, unknown>;
};

export type MovementInput =
  | { kind: "ingreso"; warehouse: WarehouseKey; quantity: number; unitCostCents: number; supplierId?: string; reference?: string; note?: string; date?: Date; purchaseId?: string }
  | { kind: "egreso"; workId: string; parts: Array<{ warehouse: WarehouseKey; quantity: number }>; reference?: string; note?: string; date?: Date }
  | { kind: "transferencia"; from: WarehouseKey; to: WarehouseKey; quantity: number; note?: string; date?: Date }
  | { kind: "ajuste"; warehouse: WarehouseKey; quantity: number; note?: string; date?: Date };

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Número correlativo de remito: R-1, R-2… */
export async function nextRemitoNumber() {
  const counter = await Counter.findByIdAndUpdate("remitos", { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return `R-${counter.seq}`;
}

function writeLevels(item: Doc, levels: Levels) {
  for (const warehouse of WAREHOUSES) item.set(qtyField(warehouse.key), round(levels[warehouse.key]));
  item.quantity = totalOf(levels);
  item.valueCents = Math.max(0, Math.round(item.quantity * item.avgCostCents));
}

/** Aplica un movimiento y lo guarda. Devuelve el material y los movimientos que dejó (con sus remitos). */
export async function applyStockMovement(item: Doc, input: MovementInput, session: Session) {
  const levels = levelsOf(item as unknown as Record<string, unknown>);
  const date = input.date ?? new Date();
  const who = { userId: session.userId, userName: session.name, date };
  const created: Array<Record<string, unknown>> = [];

  if (input.kind === "ingreso") {
    const totalCents = Math.round(input.quantity * input.unitCostCents);
    // Promedio ponderado: mezcla lo que ya había (en todos los depósitos) con lo que entra al precio nuevo.
    const newTotal = totalOf(levels) + input.quantity;
    item.avgCostCents = newTotal > 0 ? Math.round((item.valueCents + totalCents) / newTotal) : 0;
    levels[input.warehouse] = round(levels[input.warehouse] + input.quantity);
    let purchaseId = input.purchaseId;
    // La entrada cargada a mano desde Stock deja su orden de compra recibida; la que viene de una orden ya la tiene.
    if (!purchaseId) {
      const purchase = await Purchase.create({
        number: input.reference || `STK-${Date.now().toString(36).toUpperCase()}`,
        supplierId: input.supplierId, description: `${input.quantity} ${item.unit} de ${item.name} (${warehouseLabel(input.warehouse)})`,
        amountCents: totalCents, stage: "recepcion", status: "recibida",
        requestedDate: date, receivedDate: date, receiptNotes: input.note, deliverTo: input.warehouse,
        stockedAt: new Date(), stockedWarehouse: input.warehouse, stockedByName: session.name,
      });
      purchaseId = String(purchase._id);
    }
    created.push({ kind: "ingreso", quantity: input.quantity, warehouse: input.warehouse, unitCostCents: input.unitCostCents, totalCents, supplierId: input.supplierId, purchaseId, reference: input.reference, note: input.note, ...who });
  }

  if (input.kind === "egreso") {
    const parts = input.parts.filter(part => part.quantity > 0);
    if (!parts.length) throw new StockError("Poné cuánto sale de cada depósito");
    for (const part of parts) {
      if (part.quantity > levels[part.warehouse] + 1e-9) throw new StockError(`En ${warehouseLabel(part.warehouse)} hay ${levels[part.warehouse]} ${item.unit}: no alcanza para ${part.quantity}`);
    }
    const work = await Work.findById(input.workId).select("code name quoteId").lean() as { _id: Types.ObjectId; code?: string; name?: string; quoteId?: Types.ObjectId } | null;
    if (!work) throw new StockError("Elegí a qué obra se entrega el material");
    const quote = work.quoteId ? await Quote.findById(work.quoteId).select("number").lean() as { number?: string } | null : null;
    const destinationLabel = `Obra ${work.code || ""} · ${work.name || ""}`.trim();
    // Un remito por depósito: cada uno sale con su papel, aunque vayan a la misma obra.
    for (const part of parts) {
      const remito = await nextRemitoNumber();
      const totalCents = Math.round(part.quantity * item.avgCostCents);
      levels[part.warehouse] = round(levels[part.warehouse] - part.quantity);
      const expense = await Expense.create({
        workId: work._id, number: remito,
        description: `${part.quantity} ${item.unit} de ${item.name} entregados en obra (${warehouseLabel(part.warehouse)}, remito ${remito})`,
        category: "materiales", amountCents: totalCents, issueDate: date, status: "pendiente",
      });
      created.push({
        kind: "egreso", quantity: part.quantity, warehouse: part.warehouse, workId: work._id, remito, destinationLabel, quoteNumber: quote?.number,
        unitCostCents: item.avgCostCents, totalCents, expenseId: expense._id, reference: input.reference || remito, note: input.note || destinationLabel, ...who,
      });
    }
  }

  if (input.kind === "transferencia") {
    if (input.from === input.to) throw new StockError("Elegí dos depósitos distintos");
    if (input.quantity > levels[input.from] + 1e-9) throw new StockError(`En ${warehouseLabel(input.from)} hay ${levels[input.from]} ${item.unit}: no alcanza para pasar ${input.quantity}`);
    const remito = await nextRemitoNumber();
    levels[input.from] = round(levels[input.from] - input.quantity);
    levels[input.to] = round(levels[input.to] + input.quantity);
    created.push({ kind: "transferencia", quantity: input.quantity, warehouse: input.from, toWarehouse: input.to, remito, destinationLabel: warehouseLabel(input.to), reference: remito, note: input.note, ...who });
  }

  if (input.kind === "ajuste") {
    // El ajuste fija la cantidad contada, no la suma: el movimiento guarda la diferencia.
    created.push({ kind: "ajuste", quantity: round(input.quantity - levels[input.warehouse]), warehouse: input.warehouse, note: input.note, ...who });
    levels[input.warehouse] = round(input.quantity);
  }

  writeLevels(item, levels);
  item.movements.push(...created);
  await item.save();

  // El aviso de mínimo sale una vez por caída y por depósito: la clave lleva la cantidad a la que bajó.
  for (const warehouse of lowWarehouses(item as unknown as Record<string, unknown>)) {
    await notify({
      title: `Stock bajo en ${warehouse.label}: ${item.name}`,
      body: `Quedan ${levels[warehouse.key]} ${item.unit} en ${warehouse.label}. Valorizado en ${money(item.valueCents)} entre todos los depósitos.`,
      kind: "stock", href: "/app/stock", roles: ["compras"],
      dedupeKey: `stock-low-${item._id}-${warehouse.key}-${levels[warehouse.key]}`,
    });
  }

  const saved = item.toObject() as Record<string, unknown> & { movements: Array<Record<string, unknown>> };
  return { item: saved, movements: saved.movements.slice(-created.length) };
}

/* ── Pasar una orden de compra al stock ────────────────────────────────────── */

/** La unidad de stock según cómo se vende: por balde, bolsa, rollo; o por m² / metro si el mínimo lo dice. */
function unitFor(presentation = "", minSale = "") {
  // Si se vende por medida, la cantidad pedida es en esa medida (41,5 m² de un rollo de 41).
  if (/^m2$|^1 m2$/i.test(minSale.trim())) return "m2";
  if (/metro/i.test(minSale)) return "metro";
  const first = presentation.trim().split(/\s+/)[0]?.toLowerCase() || "";
  if (first.startsWith("balde")) return "balde";
  if (first.startsWith("bols")) return "bolsa";
  if (first.startsWith("rollo")) return "rollo";
  return "unidad";
}

export class PurchaseStockError extends Error {}

/**
 * Cuando llega la mercadería de una orden de compra, sus productos suman al
 * depósito elegido. Cada producto se busca en el stock por su código; si no
 * está, se da de alta. El costo que entra es el precio con el descuento, sin
 * IVA. Una orden se pasa una sola vez.
 */
export async function receivePurchase(purchaseId: string, warehouse: WarehouseKey, session: Session) {
  const purchase = await Purchase.findById(purchaseId);
  if (!purchase) throw new PurchaseStockError("Orden no encontrada");
  if (purchase.stockedAt) throw new PurchaseStockError(`La orden ${purchase.number} ya se pasó al stock (${warehouseLabel(purchase.stockedWarehouse)}).`);
  if (purchase.status === "cancelada") throw new PurchaseStockError("La orden está cancelada");
  const lines = (purchase.items || []) as Array<{ code?: string; name: string; presentation?: string; minSale?: string; quantity: number; unitCents: number }>;
  if (!lines.length) throw new PurchaseStockError("Esta orden no tiene productos cargados: la mercadería se suma desde Stock.");

  // Se marca antes de mover nada: dos clics seguidos no la pasan dos veces.
  const claimed = await Purchase.updateOne({ _id: purchase._id, stockedAt: { $exists: false } }, { $set: { stockedAt: new Date(), stockedWarehouse: warehouse, stockedByName: session.name } });
  if (!claimed.modifiedCount) throw new PurchaseStockError(`La orden ${purchase.number} ya se pasó al stock.`);

  let created = 0;
  const results: Array<{ name: string; quantity: number; unit: string; isNew: boolean }> = [];
  try {
  for (const line of lines) {
    const code = String(line.code || "").trim();
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let item = (code ? await StockItem.findOne({ sku: { $regex: `^${escaped}$`, $options: "i" } }) : null) as Doc | null;
    const isNew = !item;
    if (!item) {
      item = await StockItem.create({
        name: line.presentation ? `${line.name} · ${line.presentation}` : line.name,
        sku: code || undefined, category: "materiales", unit: unitFor(line.presentation, line.minSale),
        supplierId: purchase.supplierId, notes: `Alta automática desde la orden ${purchase.number}`,
      }) as unknown as Doc;
      created++;
    }
    await applyStockMovement(item, {
      kind: "ingreso", warehouse, quantity: line.quantity, unitCostCents: line.unitCents,
      supplierId: purchase.supplierId ? String(purchase.supplierId) : undefined,
      reference: purchase.number, note: `Orden de compra ${purchase.number}`, purchaseId: String(purchase._id),
    }, session);
    results.push({ name: item.name, quantity: line.quantity, unit: item.unit, isNew });
  }
  } catch (error) {
    // Si no llegó a sumarse nada, la orden vuelve a quedar pendiente de pasar; si ya se sumó algo, no se deshace a ciegas.
    if (!results.length) await Purchase.updateOne({ _id: purchase._id }, { $unset: { stockedAt: 1, stockedWarehouse: 1, stockedByName: 1 } });
    throw error;
  }

  await Purchase.updateOne({ _id: purchase._id }, { $set: { stage: "recepcion", status: "recibida", receivedDate: new Date() } });
  return { number: purchase.number as string, warehouse, created, items: results };
}
