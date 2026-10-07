import type { Types } from "mongoose";
import { Counter, Expense, Purchase, Quote, StockItem, StockReservation, Work } from "./models";
import { notify } from "./notifications";
import { money } from "./format";
import { levelsOf, lowWarehouses, qtyField, totalOf, type Levels } from "./stock-levels";
import { warehouseLabel, WAREHOUSES, type WarehouseKey } from "./warehouses";
import { addOwners, compactOwners, isOwner, ownersOf, takeOwners, type OwnerKey, type OwnerMatrix, type OwnerPart } from "./stock-owners";
import type { CompanyKey } from "./companies";
import type { Session } from "./auth";

/*
 * Los movimientos de stock. Es lo único que cambia cuánto hay de un material
 * (punto 3.1: no se modifica stock directamente, todo cambio es un movimiento):
 *
 * - entrada (una compra): al Depósito Central (o al Salón, si la orden se pidió para ahí), a nombre de la empresa
 *   que compró (CUIT propietario). Recalcula el costo promedio.
 * - salida a obra: resta de uno o de los dos depósitos (primero del Central),
 *   carga el costo a la obra, consume lo reservado para esa obra y deja un
 *   remito por depósito. No es una venta: no hay factura.
 * - transferencia: sale del depósito de origen y queda en tránsito; con la
 *   recepción entra al de destino. No mueve plata ni cambia el costo.
 * - venta: el remito al cliente, desde el Salón de Ventas. La factura después
 *   lo referencia y no vuelve a descontar.
 * - devolución: el cliente devuelve; vuelve al Salón.
 * - ajuste: fija lo que se contó en un depósito.
 *
 * El stock físico no queda negativo nunca: si no alcanza, no se mueve.
 */

export class StockError extends Error {}

type Doc = InstanceType<typeof StockItem> & Record<string, unknown> & {
  _id: Types.ObjectId; name: string; unit: string; sku?: string; quantity: number; avgCostCents: number; valueCents: number;
  transitQty?: number; unusableQty?: number; reservedQty?: number;
  movements: { push: (...items: unknown[]) => number };
  save: () => Promise<unknown>; toObject: () => Record<string, unknown>;
};

type Common = { note?: string; date?: Date };
export type MovementInput =
  | Common & { kind: "ingreso"; warehouse?: WarehouseKey; quantity: number; unitCostCents: number; owner?: CompanyKey; supplierId?: string; reference?: string; purchaseId?: string; ticket?: string }
  // Desde la caja, varios materiales comparten el remito de cada depósito: llega ya numerado en `remitos`.
  | Common & { kind: "egreso"; workId: string; parts: Array<{ warehouse: WarehouseKey; quantity: number }>; reference?: string; ticket?: string; remitos?: Partial<Record<WarehouseKey, string>> }
  | Common & { kind: "transferencia"; from: WarehouseKey; to: WarehouseKey; quantity: number; remito?: string; transferId?: string; owner?: OwnerKey }
  | Common & { kind: "recepcion"; from: WarehouseKey; to: WarehouseKey; sentQty: number; receivedQty: number; damagedQty?: number; ownerParts?: OwnerPart[]; remito?: string; transferId?: string }
  | Common & { kind: "venta"; quantity: number; clientId: string; remito: string; salesRemitoId?: string; destinationLabel?: string; owner?: OwnerKey }
  | Common & { kind: "devolucion"; quantity: number; clientId: string; remito: string; salesRemitoId?: string; destinationLabel?: string; ownerParts?: OwnerPart[] }
  | Common & { kind: "ajuste"; warehouse: WarehouseKey; quantity: number; owner?: CompanyKey };

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Número correlativo de remito: R-1, R-2… Lo comparten las salidas a obra, los pases y los remitos de venta. */
export async function nextRemitoNumber() {
  const counter = await Counter.findByIdAndUpdate("remitos", { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return `R-${counter.seq}`;
}

function writeLevels(item: Doc, levels: Levels, transit: number, owners: OwnerMatrix) {
  for (const warehouse of WAREHOUSES) item.set(qtyField(warehouse.key), round(levels[warehouse.key]));
  item.transitQty = round(Math.max(0, transit));
  item.set("owners", compactOwners(owners));
  // El total es lo que la empresa tiene: lo de los depósitos más lo que va en camino entre ellos.
  item.quantity = round(totalOf(levels) + item.transitQty);
  item.valueCents = Math.max(0, Math.round(item.quantity * item.avgCostCents));
}

function ensureAvailable(item: Doc, levels: Levels, warehouse: WarehouseKey, quantity: number) {
  if (quantity > levels[warehouse] + 1e-9) throw new StockError(`En ${warehouseLabel(warehouse)} hay ${levels[warehouse]} ${item.unit} de ${item.name}: no alcanza para ${quantity}`);
}

/** Aplica un movimiento y lo guarda. Devuelve el material y los movimientos que dejó (con sus remitos). */
export async function applyStockMovement(item: Doc, input: MovementInput, session: Session) {
  const levels = levelsOf(item as unknown as Record<string, unknown>);
  const owners = ownersOf(item as unknown as Record<string, unknown>);
  let transit = Number(item.transitQty || 0);
  const date = input.date ?? new Date();
  const who = { userId: session.userId, userName: session.name, date };
  const created: Array<Record<string, unknown>> = [];
  let consumed: { workId: Types.ObjectId; quoteId?: Types.ObjectId; quantity: number } | null = null;

  if (input.kind === "ingreso") {
    // La entrada cargada a mano entra al Depósito Central; al Salón llega por transferencia.
    // Solo una orden de compra pedida para el Salón puede entrar directo ahí.
    const into: WarehouseKey = input.purchaseId && input.warehouse === "salon" ? "salon" : "central";
    if (input.warehouse && input.warehouse !== into) throw new StockError("Toda compra entra al Depósito Central. Al Salón de Ventas el material llega con una transferencia desde el Central.");
    const owner: CompanyKey = isOwner(input.owner) ? input.owner : "tvp";
    const totalCents = Math.round(input.quantity * input.unitCostCents);
    // Promedio ponderado: mezcla lo que ya había (en todos lados) con lo que entra al precio nuevo.
    const newTotal = totalOf(levels) + transit + input.quantity;
    item.avgCostCents = newTotal > 0 ? Math.round((item.valueCents + totalCents) / newTotal) : 0;
    levels[into] = round(levels[into] + input.quantity);
    addOwners(owners, into, [{ owner, quantity: input.quantity }]);
    let purchaseId = input.purchaseId;
    // La entrada cargada a mano desde Stock deja su orden de compra recibida; la que viene de una orden ya la tiene.
    if (!purchaseId) {
      const purchase = await Purchase.create({
        number: input.reference || `STK-${Date.now().toString(36).toUpperCase()}`, company: owner,
        supplierId: input.supplierId, description: `${input.quantity} ${item.unit} de ${item.name} (Depósito Central)`,
        amountCents: totalCents, stage: "recepcion", status: "recibida",
        requestedDate: date, receivedDate: date, receiptNotes: input.note, deliverTo: "central",
        stockedAt: new Date(), stockedWarehouse: "central", stockedByName: session.name,
      });
      purchaseId = String(purchase._id);
    }
    created.push({ kind: "ingreso", quantity: input.quantity, warehouse: into, owner, unitCostCents: input.unitCostCents, totalCents, supplierId: input.supplierId, purchaseId, reference: input.reference, note: input.note, ticket: input.ticket, ...who });
  }

  if (input.kind === "egreso") {
    const parts = input.parts.filter(part => part.quantity > 0);
    if (!parts.length) throw new StockError("Poné cuánto sale de cada depósito");
    for (const part of parts) ensureAvailable(item, levels, part.warehouse, part.quantity);
    const work = await Work.findById(input.workId).select("code name quoteId").lean() as { _id: Types.ObjectId; code?: string; name?: string; quoteId?: Types.ObjectId } | null;
    if (!work) throw new StockError("Elegí a qué obra se entrega el material");
    const quote = work.quoteId ? await Quote.findById(work.quoteId).select("number company").lean() as { number?: string; company?: CompanyKey } | null : null;
    const destinationLabel = `Obra ${work.code || ""} · ${work.name || ""}`.trim();
    // Un remito por depósito: cada uno sale con su papel, aunque vayan a la misma obra.
    for (const part of parts) {
      const remito = input.remitos?.[part.warehouse] || await nextRemitoNumber();
      const totalCents = Math.round(part.quantity * item.avgCostCents);
      levels[part.warehouse] = round(levels[part.warehouse] - part.quantity);
      // Sale primero lo de la empresa de la obra; el material puede ser de la otra (CUIT consumidor ≠ propietario).
      const ownerParts = takeOwners(owners, part.warehouse, part.quantity, quote?.company);
      const expense = await Expense.create({
        workId: work._id, number: remito,
        description: `${part.quantity} ${item.unit} de ${item.name} entregados en obra (${warehouseLabel(part.warehouse)}, remito ${remito})`,
        category: "materiales", amountCents: totalCents, issueDate: date, status: "pendiente",
      });
      created.push({
        kind: "egreso", quantity: part.quantity, warehouse: part.warehouse, workId: work._id, remito, destinationLabel, quoteNumber: quote?.number, ownerParts,
        unitCostCents: item.avgCostCents, totalCents, expenseId: expense._id, reference: input.reference || remito, note: input.note || destinationLabel, ticket: input.ticket, ...who,
      });
    }
    consumed = { workId: work._id, quoteId: work.quoteId, quantity: round(parts.reduce((total, part) => total + part.quantity, 0)) };
  }

  if (input.kind === "transferencia") {
    if (input.from === input.to) throw new StockError("Elegí dos depósitos distintos");
    ensureAvailable(item, levels, input.from, input.quantity);
    const remito = input.remito || await nextRemitoNumber();
    levels[input.from] = round(levels[input.from] - input.quantity);
    transit = round(transit + input.quantity);
    const ownerParts = takeOwners(owners, input.from, input.quantity, input.owner);
    addOwners(owners, "transito", ownerParts);
    created.push({ kind: "transferencia", quantity: input.quantity, warehouse: input.from, toWarehouse: input.to, remito, transferId: input.transferId, ownerParts, destinationLabel: `En tránsito a ${warehouseLabel(input.to)}`, reference: remito, note: input.note, ...who });
  }

  if (input.kind === "recepcion") {
    const received = round(Math.max(0, input.receivedQty));
    const damaged = round(Math.max(0, input.damagedQty || 0));
    if (received + damaged > input.sentQty + 1e-9) throw new StockError(`Se mandaron ${input.sentQty} ${item.unit} de ${item.name}: no pueden llegar más`);
    transit = round(transit - input.sentQty);
    // Lo que viaja conserva su dueño: sale del tránsito con las mismas partes con que salió del origen.
    const travelling = takeOwners(owners, "transito", input.sentQty, input.ownerParts?.[0]?.owner);
    const arriving = takeOwners({ ...owners, transito: Object.fromEntries(travelling.map(part => [part.owner, part.quantity])) } as OwnerMatrix, "transito", received);
    levels[input.to] = round(levels[input.to] + received);
    addOwners(owners, input.to, arriving);
    if (damaged) item.unusableQty = round(Number(item.unusableQty || 0) + damaged);
    const missing = round(input.sentQty - received - damaged);
    created.push({ kind: "recepcion", quantity: received, warehouse: input.from, toWarehouse: input.to, remito: input.remito, transferId: input.transferId, ownerParts: arriving, destinationLabel: warehouseLabel(input.to),
      note: [input.note, damaged ? `${damaged} ${item.unit} llegaron dañados (no utilizable)` : "", missing > 0 ? `faltaron ${missing} ${item.unit}` : ""].filter(Boolean).join(" · ") || undefined, ...who });
    if (damaged) created.push({ kind: "no_utilizable", quantity: damaged, warehouse: input.to, transferId: input.transferId, remito: input.remito, note: "Llegó dañado en la transferencia", ...who });
  }

  if (input.kind === "venta") {
    // Punto 6.2: la salida al cliente se documenta con remito emitido desde el Salón de Ventas.
    ensureAvailable(item, levels, "salon", input.quantity);
    levels.salon = round(levels.salon - input.quantity);
    const ownerParts = takeOwners(owners, "salon", input.quantity, input.owner);
    created.push({ kind: "venta", quantity: input.quantity, warehouse: "salon", remito: input.remito, clientId: input.clientId, salesRemitoId: input.salesRemitoId, ownerParts, destinationLabel: input.destinationLabel,
      unitCostCents: item.avgCostCents, totalCents: Math.round(input.quantity * item.avgCostCents), reference: input.remito, note: input.note, ...who });
  }

  if (input.kind === "devolucion") {
    levels.salon = round(levels.salon + input.quantity);
    const parts = input.ownerParts?.length ? input.ownerParts : [{ owner: "sin_asignar" as OwnerKey, quantity: input.quantity }];
    addOwners(owners, "salon", parts);
    created.push({ kind: "devolucion", quantity: input.quantity, warehouse: "salon", remito: input.remito, clientId: input.clientId, salesRemitoId: input.salesRemitoId, ownerParts: parts, destinationLabel: input.destinationLabel, reference: input.remito, note: input.note, ...who });
  }

  if (input.kind === "ajuste") {
    // El ajuste fija la cantidad contada, no la suma: el movimiento guarda la diferencia.
    const difference = round(input.quantity - levels[input.warehouse]);
    const ownerParts = difference < 0 ? takeOwners(owners, input.warehouse, -difference) : [{ owner: (isOwner(input.owner) ? input.owner : "sin_asignar") as OwnerKey, quantity: difference }];
    if (difference > 0) addOwners(owners, input.warehouse, ownerParts);
    created.push({ kind: "ajuste", quantity: difference, warehouse: input.warehouse, ownerParts: difference ? ownerParts : undefined, note: input.note, ...who });
    levels[input.warehouse] = round(input.quantity);
  }

  writeLevels(item, levels, transit, owners);
  item.movements.push(...created);
  await item.save();
  if (consumed) await consumeReservations(item, consumed);

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

/**
 * Lo que sale a una obra consume lo que su cotización tenía reservado de ese
 * material: la reserva era justamente para eso.
 */
async function consumeReservations(item: Doc, delivered: { workId: Types.ObjectId; quoteId?: Types.ObjectId; quantity: number }) {
  if (!delivered.quoteId) return;
  const reservations = await StockReservation.find({ stockItemId: item._id, quoteId: delivered.quoteId, status: "activa" }).sort({ createdAt: 1 });
  let pending = delivered.quantity;
  let released = 0;
  for (const reservation of reservations) {
    if (pending <= 0) break;
    const open = round(reservation.quantity - reservation.consumedQty);
    const take = round(Math.min(open, pending));
    reservation.consumedQty = round(reservation.consumedQty + take);
    if (reservation.consumedQty >= reservation.quantity - 1e-9) reservation.status = "consumida";
    if (!reservation.workId) reservation.workId = delivered.workId;
    await reservation.save();
    pending = round(pending - take);
    released = round(released + take);
  }
  if (released > 0) { item.reservedQty = round(Math.max(0, Number(item.reservedQty || 0) - released)); await item.save(); }
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
 * depósito donde se pidió entregar (el Central, o el Salón de Ventas), a nombre de la empresa que compró. Cada producto se busca
 * en el stock por su código; si no está, se da de alta. El costo que entra es
 * el precio con el descuento, sin IVA. Una orden se pasa una sola vez.
 */
export async function receivePurchase(purchaseId: string, session: Session) {
  const purchase = await Purchase.findById(purchaseId);
  if (!purchase) throw new PurchaseStockError("Orden no encontrada");
  // Entra donde se pidió entregar: el Salón de Ventas o, por defecto (y si se pidió en obra), el Central.
  const warehouse: WarehouseKey = purchase.deliverTo === "salon" ? "salon" : "central";
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
      kind: "ingreso", warehouse, quantity: line.quantity, unitCostCents: line.unitCents, owner: (purchase.company || "tvp") as CompanyKey,
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
