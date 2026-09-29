import type { Types } from "mongoose";
import { Counter, Purchase, Quote, StockItem, StockTicket, Supplier, Work } from "./models";
import { applyStockMovement, nextRemitoNumber, StockError } from "./stock-service";
import { levelsOf, splitDelivery } from "./stock-levels";
import { internalBarcode } from "./barcode";
import { warehouseLabel, WAREHOUSES, type WarehouseKey } from "./warehouses";
import type { Session } from "./auth";

/*
 * La caja del depósito: se escanean los materiales que entran o salen y se
 * confirman todos juntos. Cada material guarda su movimiento como siempre
 * (src/lib/stock-service.ts); la caja agrega lo que une a la operación:
 *
 * - un número de comprobante (CJ-1, CJ-2…) para el ticket;
 * - en una entrada, una sola orden de compra recibida con todos los renglones;
 * - en una salida a obra, un solo remito por depósito con todos los materiales.
 *
 * Antes de tocar nada se revisa que alcance todo: si falta un material no se
 * mueve ninguno.
 */

export type CounterLine = { itemId: string; quantity: number; unitCostCents?: number };
export type CounterInput =
  | { kind: "ingreso"; warehouse: WarehouseKey; supplierId?: string; reference?: string; note?: string; date?: Date; lines: CounterLine[] }
  | { kind: "egreso"; workId: string; warehouse?: WarehouseKey; note?: string; date?: Date; lines: CounterLine[] };

type ItemDoc = Parameters<typeof applyStockMovement>[0] & { barcode?: string };
type Part = { warehouse: WarehouseKey; quantity: number };

const round = (value: number) => Math.round(value * 1000) / 1000;

export async function nextTicketNumber() {
  const counter = await Counter.findByIdAndUpdate("stock_tickets", { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return `CJ-${counter.seq}`;
}

/** El mismo material escaneado dos veces es un solo renglón con la suma. */
function mergeLines(lines: CounterLine[]) {
  const merged = new Map<string, CounterLine>();
  for (const line of lines) {
    const current = merged.get(line.itemId);
    if (current) current.quantity = round(current.quantity + line.quantity);
    else merged.set(line.itemId, { ...line });
  }
  return [...merged.values()].filter(line => line.quantity > 0);
}

export async function registerCounterOperation(input: CounterInput, session: Session) {
  const lines = mergeLines(input.lines);
  if (!lines.length) throw new StockError("Escaneá al menos un material");
  const docs = await StockItem.find({ _id: { $in: lines.map(line => line.itemId) } }) as unknown as ItemDoc[];
  const byId = new Map(docs.map(doc => [String(doc._id), doc]));
  const missing = lines.find(line => !byId.has(line.itemId));
  if (missing) throw new StockError("Uno de los materiales ya no está en el stock: sacalo de la lista y volvé a escanearlo");
  const date = input.date ?? new Date();

  // Salida: cómo sale cada material y si alcanza, antes de mover nada.
  const plan = new Map<string, Part[]>();
  type WorkRow = { _id: Types.ObjectId; code?: string; name?: string; quoteId?: Types.ObjectId };
  let work: WorkRow | null = null;
  let quoteNumber: string | undefined;
  if (input.kind === "egreso") {
    work = await Work.findById(input.workId).select("code name quoteId").lean() as WorkRow | null;
    if (!work) throw new StockError("Elegí a qué obra se entrega el material");
    if (work.quoteId) quoteNumber = (await Quote.findById(work.quoteId).select("number").lean() as { number?: string } | null)?.number;
    const short: string[] = [];
    for (const line of lines) {
      const item = byId.get(line.itemId)!;
      const levels = levelsOf(item as unknown as Record<string, unknown>);
      if (input.warehouse) {
        if (line.quantity > levels[input.warehouse] + 1e-9) short.push(`${item.name}: hay ${levels[input.warehouse]} ${item.unit} en ${warehouseLabel(input.warehouse)}`);
        plan.set(line.itemId, [{ warehouse: input.warehouse, quantity: line.quantity }]);
      } else {
        const split = splitDelivery(levels, line.quantity);
        if (split.missing > 0) short.push(`${item.name}: faltan ${split.missing} ${item.unit}`);
        plan.set(line.itemId, split.parts);
      }
    }
    if (short.length) throw new StockError(`No alcanza el stock. ${short.join(" · ")}`);
  }

  const number = await nextTicketNumber();
  const ticketLines: Array<Record<string, unknown>> = [];
  const remitos: Array<{ number: string; warehouse: WarehouseKey }> = [];
  const changed: Array<{ item: ItemDoc; before: Record<string, unknown>; after: Record<string, unknown> }> = [];
  let supplierName: string | undefined;
  let purchaseId: string | undefined;

  if (input.kind === "ingreso") {
    const supplier = input.supplierId ? await Supplier.findById(input.supplierId).select("name").lean() as { name?: string } | null : null;
    supplierName = supplier?.name;
    const items = lines.map(line => {
      const item = byId.get(line.itemId)!;
      const unitCents = Math.max(0, Math.round(line.unitCostCents || 0));
      return { code: item.sku || item.barcode, name: item.name, quantity: line.quantity, listPriceCents: unitCents, unitCents, totalCents: Math.round(line.quantity * unitCents) };
    });
    // Una sola orden recibida por toda la entrada, con su número de caja: es la que ve Compras.
    const purchase = await Purchase.create({
      number, supplierId: input.supplierId, items,
      description: `Entrada por caja ${number}: ${items.length === 1 ? `${items[0].quantity} de ${items[0].name}` : `${items.length} materiales`} (${warehouseLabel(input.warehouse)})`,
      amountCents: items.reduce((total, line) => total + line.totalCents, 0), subtotalCents: items.reduce((total, line) => total + line.totalCents, 0),
      stage: "recepcion", status: "recibida", requestedDate: date, receivedDate: date,
      receiptNotes: [input.reference && `Comprobante del proveedor: ${input.reference}`, input.note].filter(Boolean).join(" · ") || undefined,
      deliverTo: input.warehouse, stockedAt: new Date(), stockedWarehouse: input.warehouse, stockedByName: session.name,
      userId: session.userId, userName: session.name,
    });
    purchaseId = String(purchase._id);
    for (const line of lines) {
      const item = byId.get(line.itemId)!;
      const before = item.toObject();
      const unitCostCents = Math.max(0, Math.round(line.unitCostCents || 0));
      const result = await applyStockMovement(item, {
        kind: "ingreso", warehouse: input.warehouse, quantity: line.quantity, unitCostCents,
        supplierId: input.supplierId, reference: input.reference || number, note: input.note || `Caja ${number}`, date, purchaseId, ticket: number,
      }, session);
      changed.push({ item, before, after: result.item });
      ticketLines.push({ stockItemId: item._id, name: item.name, sku: item.sku, barcode: item.barcode, unit: item.unit, quantity: line.quantity, unitCostCents, totalCents: Math.round(line.quantity * unitCostCents), parts: [{ warehouse: input.warehouse, quantity: line.quantity }] });
    }
  } else {
    // Un remito por depósito, compartido por todos los materiales que salen de ahí.
    const used = WAREHOUSES.filter(warehouse => [...plan.values()].some(parts => parts.some(part => part.warehouse === warehouse.key && part.quantity > 0)));
    const numbers: Partial<Record<WarehouseKey, string>> = {};
    for (const warehouse of used) { numbers[warehouse.key] = await nextRemitoNumber(); remitos.push({ number: numbers[warehouse.key]!, warehouse: warehouse.key }); }
    for (const line of lines) {
      const item = byId.get(line.itemId)!;
      const before = item.toObject();
      const parts = plan.get(line.itemId)!;
      const result = await applyStockMovement(item, { kind: "egreso", workId: input.workId, parts, note: input.note, date, ticket: number, remitos: numbers }, session);
      const totalCents = result.movements.reduce((total, movement) => total + Number(movement.totalCents || 0), 0);
      changed.push({ item, before, after: result.item });
      ticketLines.push({ stockItemId: item._id, name: item.name, sku: item.sku, barcode: item.barcode, unit: item.unit, quantity: line.quantity, unitCostCents: item.avgCostCents, totalCents, parts: parts.map(part => ({ ...part, remito: numbers[part.warehouse] })) });
    }
  }

  const ticket = await StockTicket.create({
    number, kind: input.kind, date,
    warehouse: input.warehouse,
    supplierId: input.kind === "ingreso" ? input.supplierId : undefined, supplierName,
    workId: work?._id, destinationLabel: work ? `Obra ${work.code || ""} · ${work.name || ""}`.trim() : undefined, quoteNumber,
    purchaseId, reference: input.kind === "ingreso" ? input.reference : undefined, note: input.note,
    lines: ticketLines, remitos, totalCents: ticketLines.reduce((total, line) => total + Number(line.totalCents || 0), 0),
    userId: session.userId, userName: session.name,
  });
  return { ticket: ticket.toObject() as Record<string, unknown>, changed };
}

/** Busca un material por lo que leyó el lector: primero el código de barras, después el código interno. */
export async function findByCode(code: string) {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return await StockItem.findOne({ barcode: code }, { movements: { $slice: -12 } }).lean()
    || await StockItem.findOne({ barcode: { $regex: `^${escaped}$`, $options: "i" } }, { movements: { $slice: -12 } }).lean()
    || await StockItem.findOne({ sku: { $regex: `^${escaped}$`, $options: "i" } }, { movements: { $slice: -12 } }).lean();
}

/** Le da a un material un código propio para imprimirle la etiqueta. Si ya tiene uno, queda ese. */
export async function ensureBarcode(itemId: string) {
  const item = await StockItem.findById(itemId).select("barcode name");
  if (!item) throw new StockError("Material no encontrado");
  if (item.barcode) return String(item.barcode);
  for (;;) {
    const counter = await Counter.findByIdAndUpdate("barcodes", { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
    const code = internalBarcode(counter.seq);
    if (await StockItem.exists({ barcode: code })) continue;
    item.barcode = code;
    await item.save();
    return code;
  }
}
