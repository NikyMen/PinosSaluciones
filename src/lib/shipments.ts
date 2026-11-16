import type { Types } from "mongoose";
import { Counter, Expense, Shipment, StockItem } from "./models";
import { applyStockMovement, StockError } from "./stock-service";
import { levelsOf } from "./stock-levels";
import { warehouseLabel, type WarehouseKey } from "./warehouses";
import type { CompanyKey } from "./companies";
import type { OwnerPart } from "./stock-owners";
import type { Session } from "./auth";

/*
 * Envíos por transporte (encomiendas), pedido de Compras del 13/11/2026:
 * 1. Sale del depósito con su remito (ENV-n) y el valor declarado, que es la
 *    suma de cantidad × precio de cada renglón (arranca con el último costo).
 * 2. Nadie confirma la llegada: queda "despachado".
 * 3. Después se carga el N° de guía o el remito del transporte ("con guía").
 * Con obra, el costo se carga a la obra, como en la salida a obra.
 */

type ItemDoc = Parameters<typeof applyStockMovement>[0];
export type ShipmentLineInput = { itemId: string; quantity: number; declaredUnitCents?: number };
export type ShipmentInput = {
  company: CompanyKey; from: WarehouseKey; destination: string; receiver?: string; carrier: string;
  packages?: number; pallets?: number; workId?: string; note?: string; lines: ShipmentLineInput[];
};

const round = (value: number) => Math.round(value * 1000) / 1000;

async function nextShipmentNumber() {
  const counter = await Counter.findByIdAndUpdate("shipments", { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return `ENV-${counter.seq}`;
}

/** Despacha el envío. Si no alcanza un material, no sale ninguno. */
export async function sendShipment(input: ShipmentInput, session: Session) {
  const merged = new Map<string, ShipmentLineInput>();
  for (const line of input.lines) {
    if (!(line.quantity > 0)) continue;
    const current = merged.get(line.itemId);
    merged.set(line.itemId, { itemId: line.itemId, quantity: round((current?.quantity || 0) + line.quantity), declaredUnitCents: line.declaredUnitCents ?? current?.declaredUnitCents });
  }
  const lines = [...merged.values()];
  if (!lines.length) throw new StockError("Poné al menos un material con su cantidad");
  const docs = await StockItem.find({ _id: { $in: lines.map(line => line.itemId) } }) as unknown as ItemDoc[];
  const byId = new Map(docs.map(doc => [String(doc._id), doc]));
  const short: string[] = [];
  for (const line of lines) {
    const item = byId.get(line.itemId);
    if (!item) throw new StockError("Uno de los materiales ya no está en el stock");
    const available = levelsOf(item as unknown as Record<string, unknown>)[input.from];
    if (line.quantity > available + 1e-9) short.push(`${item.name}: hay ${available} ${item.unit} en ${warehouseLabel(input.from)}`);
  }
  if (short.length) throw new StockError(`No alcanza. ${short.join(" · ")}`);

  const number = await nextShipmentNumber();
  const shipment = await Shipment.create({
    number, company: input.company, from: input.from, destination: input.destination, receiver: input.receiver || undefined, carrier: input.carrier,
    packages: input.packages || undefined, pallets: input.pallets || undefined, workId: input.workId || undefined, note: input.note || undefined,
    status: "despachado", sentAt: new Date(), sentByName: session.name, lines: [],
  });
  const destinationLabel = `${input.destination} (por ${input.carrier})`;
  const shipmentLines: Array<Record<string, unknown>> = [];
  const changed: Array<{ item: ItemDoc; before: Record<string, unknown>; after: Record<string, unknown> }> = [];
  for (const line of lines) {
    const item = byId.get(line.itemId)!;
    const before = item.toObject();
    const result = await applyStockMovement(item, { kind: "envio", warehouse: input.from, quantity: line.quantity, remito: number, shipmentId: String(shipment._id), destinationLabel, workId: input.workId, owner: input.company, note: input.note }, session);
    const movement = result.movements[0] as { ownerParts?: OwnerPart[]; expenseId?: Types.ObjectId };
    const unit = Math.max(0, Math.round(line.declaredUnitCents ?? Number(item.avgCostCents || 0)));
    shipmentLines.push({ stockItemId: item._id, name: item.name, code: item.sku, unit: item.unit, quantity: line.quantity, ownerParts: movement.ownerParts,
      declaredUnitCents: unit, declaredCents: Math.round(unit * line.quantity), expenseId: movement.expenseId });
    changed.push({ item, before, after: result.item });
  }
  shipment.set("lines", shipmentLines);
  shipment.set("declaredCents", shipmentLines.reduce((total, line) => total + Number(line.declaredCents || 0), 0));
  await shipment.save();
  return { shipment: shipment.toObject() as Record<string, unknown>, changed };
}

/** El N° de guía o el remito del transporte, con su foto o PDF. Se puede corregir. */
export async function setShipmentTracking(id: string, input: { trackingNumber: string; files?: Array<{ path: string; name?: string }> }, session: Session) {
  const shipment = await Shipment.findById(id);
  if (!shipment) throw new StockError("Envío no encontrado");
  if (shipment.status === "anulado") throw new StockError("El envío está anulado");
  shipment.trackingNumber = input.trackingNumber;
  if (input.files?.length) shipment.set("trackingFiles", [...(shipment.trackingFiles || []), ...input.files]);
  shipment.status = "con_guia";
  shipment.trackingAt = new Date();
  shipment.trackingByName = session.name;
  await shipment.save();
  return shipment.toObject() as Record<string, unknown>;
}

/** Anula un envío que todavía no tiene guía: el material vuelve al depósito y se saca el costo de la obra. */
export async function cancelShipment(id: string, reason: string, session: Session) {
  const shipment = await Shipment.findById(id);
  if (!shipment) throw new StockError("Envío no encontrado");
  if (shipment.status !== "despachado") throw new StockError(shipment.status === "anulado" ? "El envío ya está anulado" : "El envío ya tiene la guía del transporte: salió y no se anula");
  const claimed = await Shipment.updateOne({ _id: shipment._id, status: "despachado" }, { $set: { status: "anulado", cancelReason: reason, cancelledAt: new Date(), cancelledByName: session.name } });
  if (!claimed.modifiedCount) throw new StockError("El envío ya cambió de estado");
  for (const line of shipment.lines as Array<{ stockItemId: Types.ObjectId; quantity: number; ownerParts?: OwnerPart[]; expenseId?: Types.ObjectId }>) {
    const item = await StockItem.findById(line.stockItemId) as unknown as ItemDoc | null;
    if (item) await applyStockMovement(item, { kind: "envio_anulado", warehouse: shipment.from as WarehouseKey, quantity: line.quantity, ownerParts: line.ownerParts, remito: shipment.number, shipmentId: String(shipment._id), note: `Envío anulado: ${reason}` }, session);
    if (line.expenseId) await Expense.deleteOne({ _id: line.expenseId });
  }
  return (await Shipment.findById(id).lean()) as Record<string, unknown>;
}
