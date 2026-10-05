import type { Types } from "mongoose";
import { StockItem, StockTransfer } from "./models";
import { applyStockMovement, nextRemitoNumber, StockError } from "./stock-service";
import { levelsOf } from "./stock-levels";
import { notify } from "./notifications";
import { warehouseLabel, type WarehouseKey } from "./warehouses";
import type { OwnerKey, OwnerPart } from "./stock-owners";
import type { Session } from "./auth";

/*
 * Transferencias entre depósitos (punto 2.3 de la especificación):
 * 1. Sale del depósito de origen con su remito y queda "en tránsito".
 * 2. El depósito de destino confirma lo que recibió. Lo que faltó o llegó
 *    dañado queda documentado en el renglón; lo dañado pasa a "no utilizable".
 * No es una venta ni se factura: solo cambia dónde está el material.
 */

type ItemDoc = Parameters<typeof applyStockMovement>[0];
export type TransferLineInput = { itemId: string; quantity: number };
export type ReceptionLineInput = { itemId: string; receivedQty: number; damagedQty?: number; note?: string };

const round = (value: number) => Math.round(value * 1000) / 1000;

function merge(lines: TransferLineInput[]) {
  const merged = new Map<string, number>();
  for (const line of lines) if (line.quantity > 0) merged.set(line.itemId, round((merged.get(line.itemId) || 0) + line.quantity));
  return [...merged].map(([itemId, quantity]) => ({ itemId, quantity }));
}

/** Manda material de un depósito al otro. Si no alcanza uno, no sale ninguno. */
export async function sendTransfer(input: { from: WarehouseKey; to: WarehouseKey; lines: TransferLineInput[]; note?: string; date?: Date; owner?: OwnerKey; quoteId?: string }, session: Session) {
  if (input.from === input.to) throw new StockError("Elegí dos depósitos distintos");
  const lines = merge(input.lines);
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

  const number = await nextRemitoNumber();
  const transfer = await StockTransfer.create({ number, from: input.from, to: input.to, status: "en_transito", note: input.note, sentAt: input.date ?? new Date(), sentByName: session.name, quoteId: input.quoteId, lines: [] });
  const transferLines: Array<Record<string, unknown>> = [];
  const changed: Array<{ item: ItemDoc; before: Record<string, unknown>; after: Record<string, unknown> }> = [];
  for (const line of lines) {
    const item = byId.get(line.itemId)!;
    const before = item.toObject();
    const result = await applyStockMovement(item, { kind: "transferencia", from: input.from, to: input.to, quantity: line.quantity, remito: number, transferId: String(transfer._id), owner: input.owner, note: input.note, date: input.date }, session);
    const movement = result.movements[0] as { ownerParts?: OwnerPart[] };
    transferLines.push({ stockItemId: item._id, name: item.name, unit: item.unit, quantity: line.quantity, ownerParts: movement.ownerParts });
    changed.push({ item, before, after: result.item });
  }
  transfer.set("lines", transferLines);
  await transfer.save();
  await notify({
    title: `Transferencia ${number} en camino a ${warehouseLabel(input.to)}`,
    body: `${transferLines.length} ${transferLines.length === 1 ? "material" : "materiales"} desde ${warehouseLabel(input.from)}. Confirmá la recepción cuando llegue.`,
    kind: "stock", href: "/app/transferencias", roles: ["compras"], dedupeKey: `transfer-${transfer._id}`,
  });
  return { transfer: transfer.toObject() as Record<string, unknown>, changed };
}

/**
 * El destino confirma lo que llegó. Sin renglones, llegó todo bien. Con
 * renglones, lo recibido entra al depósito, lo dañado va a "no utilizable" y
 * la diferencia queda anotada.
 */
export async function receiveTransfer(transferId: string, input: { lines?: ReceptionLineInput[]; note?: string; date?: Date }, session: Session) {
  const transfer = await StockTransfer.findById(transferId);
  if (!transfer) throw new StockError("Transferencia no encontrada");
  if (transfer.status !== "en_transito") throw new StockError(`La transferencia ${transfer.number} ya se ${transfer.status === "anulada" ? "anuló" : "recibió"}`);
  const reported = new Map((input.lines || []).map(line => [line.itemId, line]));
  for (const line of transfer.lines as Array<{ stockItemId: Types.ObjectId; quantity: number; name?: string }>) {
    const report = reported.get(String(line.stockItemId));
    if (report && Number(report.receivedQty || 0) + Number(report.damagedQty || 0) > line.quantity + 1e-9) throw new StockError(`De ${line.name} se mandaron ${line.quantity}: no pueden llegar más`);
  }
  // Se marca antes de mover nada: dos confirmaciones seguidas no la reciben dos veces.
  const claimed = await StockTransfer.updateOne({ _id: transfer._id, status: "en_transito" }, { $set: { status: "recibida" } });
  if (!claimed.modifiedCount) throw new StockError(`La transferencia ${transfer.number} ya se recibió`);

  let differences = false;
  const changed: Array<{ item: ItemDoc; before: Record<string, unknown>; after: Record<string, unknown> }> = [];
  for (const line of transfer.lines as Array<{ stockItemId: Types.ObjectId; quantity: number; ownerParts?: OwnerPart[]; receivedQty?: number; damagedQty?: number; missingQty?: number; note?: string; name?: string }>) {
    const report = reported.get(String(line.stockItemId));
    const received = round(Math.max(0, report ? Number(report.receivedQty) : line.quantity));
    const damaged = round(Math.max(0, Number(report?.damagedQty || 0)));
    const item = await StockItem.findById(line.stockItemId) as unknown as ItemDoc | null;
    if (!item) continue;
    const before = item.toObject();
    const result = await applyStockMovement(item, { kind: "recepcion", from: transfer.from as WarehouseKey, to: transfer.to as WarehouseKey, sentQty: line.quantity, receivedQty: received, damagedQty: damaged, ownerParts: line.ownerParts, remito: transfer.number, transferId: String(transfer._id), note: report?.note, date: input.date }, session);
    line.receivedQty = received; line.damagedQty = damaged; line.missingQty = round(line.quantity - received - damaged); line.note = report?.note;
    if (damaged || line.missingQty > 0) differences = true;
    changed.push({ item, before, after: result.item });
  }
  transfer.status = differences ? "con_diferencias" : "recibida";
  transfer.receivedAt = input.date ?? new Date();
  transfer.receivedByName = session.name;
  transfer.receptionNote = input.note;
  transfer.markModified("lines");
  await transfer.save();
  return { transfer: transfer.toObject() as Record<string, unknown>, changed };
}

/** Anular una transferencia que todavía no llegó: el material vuelve entero al depósito de origen. */
export async function cancelTransfer(transferId: string, reason: string, session: Session) {
  const transfer = await StockTransfer.findById(transferId);
  if (!transfer) throw new StockError("Transferencia no encontrada");
  if (transfer.status !== "en_transito") throw new StockError("Solo se anula una transferencia que todavía está en tránsito");
  const claimed = await StockTransfer.updateOne({ _id: transfer._id, status: "en_transito" }, { $set: { status: "anulada" } });
  if (!claimed.modifiedCount) throw new StockError("La transferencia ya cambió de estado");
  for (const line of transfer.lines as Array<{ stockItemId: Types.ObjectId; quantity: number; ownerParts?: OwnerPart[] }>) {
    const item = await StockItem.findById(line.stockItemId) as unknown as ItemDoc | null;
    if (!item) continue;
    await applyStockMovement(item, { kind: "recepcion", from: transfer.to as WarehouseKey, to: transfer.from as WarehouseKey, sentQty: line.quantity, receivedQty: line.quantity, ownerParts: line.ownerParts, remito: transfer.number, transferId: String(transfer._id), note: `Transferencia anulada: ${reason}` }, session);
  }
  transfer.status = "anulada";
  transfer.receptionNote = `Anulada por ${session.name}: ${reason}`;
  transfer.receivedAt = new Date();
  transfer.receivedByName = session.name;
  await transfer.save();
  return transfer.toObject() as Record<string, unknown>;
}
