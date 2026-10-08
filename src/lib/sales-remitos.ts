import { Types } from "mongoose";
import { z } from "zod";
import { Client, Invoice, SalesRemito, StockItem } from "./models";
import { applyStockMovement, nextRemitoNumber, StockError } from "./stock-service";
import { levelsOf } from "./stock-levels";
import { HttpError } from "./api";
import { companyOf } from "./companies";
import { VOID_INVOICE_STATUSES } from "./invoice-labels";
import type { OwnerPart } from "./stock-owners";
import { invoicedQtyOf, pendingQtyOf, remitoBillingStatus, type RemitoInvoiceLine, type RemitoLineLike } from "./remito-billing";
import type { Session } from "./auth";

/*
 * Remitos de venta (punto 6 de la especificación). La venta al público sigue
 * Depósito Central → transferencia → Salón de Ventas → remito al cliente →
 * factura. El remito es lo que descuenta el stock del Salón; la factura (A, B
 * o X) lo referencia y no vuelve a descontar. Una factura puede juntar varios
 * remitos del mismo cliente y la misma empresa. Una devolución del cliente es
 * un remito de entrada que vuelve el material al Salón.
 */

type ItemDoc = Parameters<typeof applyStockMovement>[0];
type Lean = Record<string, unknown> & { _id: Types.ObjectId };

const id = z.string().regex(/^[a-f\d]{24}$/i, "ID inválido");
export const salesRemitoSchema = z.object({
  company: z.enum(["tvp", "constructora"]).default("tvp"),
  clientId: id,
  quoteId: z.union([id, z.literal("")]).optional().transform(value => value || undefined),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Poné la fecha").transform(value => new Date(`${value}T00:00:00.000Z`)),
  note: z.string().trim().max(1000).optional().default(""),
  lines: z.array(z.object({ itemId: id, quantity: z.coerce.number().positive("Cada cantidad tiene que ser mayor a cero"), unitPriceCents: z.coerce.number().int().min(0).default(0) })).min(1, "Agregá al menos un material").max(100),
});
export type SalesRemitoInput = z.infer<typeof salesRemitoSchema>;

export const returnSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Poné la fecha").transform(value => new Date(`${value}T00:00:00.000Z`)).optional(),
  note: z.string().trim().max(1000).optional().default(""),
  lines: z.array(z.object({ itemId: id, quantity: z.coerce.number().positive() })).min(1, "Poné qué devuelve el cliente"),
});

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Emite el remito de salida al cliente desde el Salón. Si un material no alcanza, no sale ninguno. */
export async function createSalesRemito(input: SalesRemitoInput, session: Session) {
  const client = await Client.findById(input.clientId).select("name").lean<{ name?: string }>();
  if (!client) throw new HttpError("Elegí el cliente");
  const merged = new Map<string, { itemId: string; quantity: number; unitPriceCents: number }>();
  for (const line of input.lines) {
    const current = merged.get(line.itemId);
    if (current) current.quantity = round(current.quantity + line.quantity); else merged.set(line.itemId, { ...line });
  }
  const lines = [...merged.values()];
  const docs = await StockItem.find({ _id: { $in: lines.map(line => line.itemId) } }) as unknown as ItemDoc[];
  const byId = new Map(docs.map(doc => [String(doc._id), doc]));
  const short: string[] = [];
  for (const line of lines) {
    const item = byId.get(line.itemId);
    if (!item) throw new StockError("Uno de los materiales ya no está en el stock");
    const salon = levelsOf(item as unknown as Record<string, unknown>).salon;
    if (line.quantity > salon + 1e-9) short.push(`${item.name}: en el Salón hay ${salon} ${item.unit}`);
  }
  if (short.length) throw new StockError(`No alcanza el stock del Salón de Ventas (si está en el Central, primero hay que transferirlo). ${short.join(" · ")}`);

  const number = await nextRemitoNumber();
  const remito = await SalesRemito.create({ number, kind: "salida", company: input.company, clientId: input.clientId, quoteId: input.quoteId, date: input.date, warehouse: "salon", note: input.note, userId: session.userId, userName: session.name, lines: [] });
  const remitoLines: Array<Record<string, unknown>> = [];
  const changed: Array<{ item: ItemDoc; before: Record<string, unknown>; after: Record<string, unknown> }> = [];
  for (const line of lines) {
    const item = byId.get(line.itemId)!;
    const before = item.toObject();
    const result = await applyStockMovement(item, { kind: "venta", quantity: line.quantity, clientId: input.clientId, remito: number, salesRemitoId: String(remito._id), destinationLabel: client.name, owner: input.company, note: input.note, date: input.date }, session);
    const movement = result.movements[0] as { ownerParts?: OwnerPart[]; unitCostCents?: number };
    remitoLines.push({ stockItemId: item._id, name: item.name, unit: item.unit, quantity: line.quantity, unitPriceCents: line.unitPriceCents, totalCents: Math.round(line.quantity * line.unitPriceCents), unitCostCents: movement.unitCostCents, ownerParts: movement.ownerParts });
    changed.push({ item, before, after: result.item });
  }
  remito.set("lines", remitoLines);
  remito.totalCents = remitoLines.reduce((total, line) => total + Number(line.totalCents || 0), 0);
  await remito.save();
  return { remito: remito.toObject() as Record<string, unknown>, changed };
}

/** El cliente devuelve material de un remito: vuelve al Salón, con su mismo dueño, y queda un remito de entrada. */
export async function returnSalesRemito(remitoId: string, input: z.infer<typeof returnSchema>, session: Session) {
  const original = await SalesRemito.findById(remitoId).lean<Lean & { number: string; kind: string; status: string; company: string; clientId: Types.ObjectId; lines: Array<{ stockItemId: Types.ObjectId; name: string; unit: string; quantity: number; unitPriceCents: number; ownerParts?: OwnerPart[] }> }>();
  if (!original || original.kind !== "salida") throw new HttpError("Remito no encontrado");
  if (original.status === "anulado") throw new HttpError("El remito está anulado");
  // Lo que ya se devolvió de este remito no se devuelve dos veces.
  const previous = await SalesRemito.find({ returnsId: original._id, kind: "devolucion", status: { $ne: "anulado" } }).lean<Array<{ lines: Array<{ stockItemId: Types.ObjectId; quantity: number }> }>>();
  const returned = new Map<string, number>();
  for (const back of previous) for (const line of back.lines) returned.set(String(line.stockItemId), round((returned.get(String(line.stockItemId)) || 0) + line.quantity));
  const client = await Client.findById(original.clientId).select("name").lean<{ name?: string }>();

  const number = await nextRemitoNumber();
  const lines: Array<Record<string, unknown>> = [];
  for (const line of input.lines) {
    const sold = original.lines.find(candidate => String(candidate.stockItemId) === line.itemId);
    if (!sold) throw new HttpError("Ese material no está en el remito");
    const open = round(sold.quantity - (returned.get(line.itemId) || 0));
    if (line.quantity > open + 1e-9) throw new HttpError(`De ${sold.name} se pueden devolver hasta ${open} ${sold.unit}`);
  }
  const back = await SalesRemito.create({ number, kind: "devolucion", returnsId: original._id, company: original.company, clientId: original.clientId, date: input.date ?? new Date(), warehouse: "salon", note: input.note, userId: session.userId, userName: session.name, lines: [] });
  for (const line of input.lines) {
    const sold = original.lines.find(candidate => String(candidate.stockItemId) === line.itemId)!;
    const item = await StockItem.findById(line.itemId) as unknown as ItemDoc | null;
    if (!item) continue;
    // Vuelve con el mismo dueño con que salió, en proporción.
    const ratio = line.quantity / sold.quantity;
    const ownerParts = (sold.ownerParts || []).map(part => ({ owner: part.owner, quantity: round(part.quantity * ratio) })).filter(part => part.quantity > 0);
    await applyStockMovement(item, { kind: "devolucion", quantity: line.quantity, clientId: String(original.clientId), remito: number, salesRemitoId: String(back._id), destinationLabel: client?.name, ownerParts, note: input.note || `Devolución del remito ${original.number}`, date: input.date }, session);
    lines.push({ stockItemId: item._id, name: sold.name, unit: sold.unit, quantity: line.quantity, unitPriceCents: sold.unitPriceCents, totalCents: Math.round(line.quantity * sold.unitPriceCents), ownerParts });
  }
  back.set("lines", lines);
  back.totalCents = lines.reduce((total, line) => total + Number(line.totalCents || 0), 0);
  await back.save();
  return back.toObject() as Record<string, unknown>;
}

/** Anular un remito que todavía no se facturó: el material vuelve al Salón. */
export async function cancelSalesRemito(remitoId: string, reason: string, session: Session) {
  const remito = await SalesRemito.findById(remitoId);
  if (!remito || remito.kind !== "salida") throw new HttpError("Remito no encontrado");
  if (remito.status !== "pendiente") throw new HttpError(remito.status === "facturado" ? "El remito ya está facturado: primero hay que anular la factura" : "El remito ya está anulado");
  if (await SalesRemito.exists({ returnsId: remito._id, status: { $ne: "anulado" } })) throw new HttpError("El remito tiene devoluciones cargadas: no se anula");
  const claimed = await SalesRemito.updateOne({ _id: remito._id, status: "pendiente" }, { $set: { status: "anulado", note: [remito.note, `Anulado por ${session.name}: ${reason}`].filter(Boolean).join(" · ") } });
  if (!claimed.modifiedCount) throw new HttpError("El remito ya cambió de estado");
  for (const line of remito.lines as Array<{ stockItemId: Types.ObjectId; quantity: number; ownerParts?: OwnerPart[] }>) {
    const item = await StockItem.findById(line.stockItemId) as unknown as ItemDoc | null;
    if (!item) continue;
    await applyStockMovement(item, { kind: "devolucion", quantity: line.quantity, clientId: String(remito.clientId), remito: remito.number, salesRemitoId: String(remito._id), ownerParts: line.ownerParts, note: `Remito ${remito.number} anulado: ${reason}` }, session);
  }
  return SalesRemito.findById(remitoId).lean();
}

/* ── La factura que referencia remitos ─────────────────────────────────────── */

type RemitoDoc = Lean & { number: string; kind: string; status: string; clientId: Types.ObjectId; company: string; billingRev?: number; lines: RemitoLineLike[]; invoiceIds?: Types.ObjectId[] };

/** Las cantidades que pide la factura, una por renglón: `remitoLines` puede llegar como texto JSON del formulario. */
function requestedLines(data: Record<string, unknown>): RemitoInvoiceLine[] | null {
  let raw = data.remitoLines;
  if (typeof raw === "string") { try { raw = raw.trim() ? JSON.parse(raw) : null; } catch { throw new HttpError("Las cantidades de los remitos no se entienden"); } }
  if (!Array.isArray(raw) || !raw.length) return null;
  return raw.map(entry => ({ remitoId: String(entry?.remitoId || ""), line: Number(entry?.line), quantity: round(Number(entry?.quantity || 0)) }))
    .filter(entry => entry.quantity > 0);
}

/**
 * Antes de facturar: los remitos tienen que ser salidas del mismo cliente, ser
 * de la empresa que factura y tener algo pendiente de facturar. La factura puede
 * llevar sólo una parte (`remitoLines`); si no dice, factura todo lo pendiente.
 */
export async function checkRemitosForInvoice(data: Record<string, unknown>) {
  const ids = Array.isArray(data.remitoIds) ? data.remitoIds.map(String).filter(Boolean) : [];
  if (!ids.length) { delete data.remitoIds; delete data.remitoLines; return []; }
  const remitos = await SalesRemito.find({ _id: { $in: ids } }).lean<RemitoDoc[]>();
  if (remitos.length !== new Set(ids).size) throw new HttpError("Uno de los remitos no existe");
  const company = companyOf(data.company).key;
  for (const remito of remitos) {
    if (remito.kind !== "salida") throw new HttpError(`El ${remito.number} es una devolución: no se factura`);
    if (String(remito.clientId) !== String(data.clientId)) throw new HttpError(`El remito ${remito.number} es de otro cliente`);
    if (remito.company !== company) throw new HttpError(`El remito ${remito.number} lo factura ${companyOf(remito.company).short}`);
    // En una sustitución la X ya tenía estos remitos: pasan a la fiscal tal cual.
    if (data.replacesId) { if (!["facturado", "parcial"].includes(remito.status)) throw new HttpError(`El remito ${remito.number} ya está ${remito.status}`); continue; }
    if (!["pendiente", "parcial"].includes(remito.status)) throw new HttpError(`El remito ${remito.number} ya está ${remito.status}`);
  }
  data.remitoIds = remitos.map(remito => remito._id);
  if (data.replacesId) return remitos;

  const requested = requestedLines(data);
  const lines: RemitoInvoiceLine[] = requested ?? remitos.flatMap(remito => remito.lines.map((line, index) => ({ remitoId: String(remito._id), line: index, quantity: pendingQtyOf(line, remito.status) })).filter(entry => entry.quantity > 0));
  for (const entry of lines) {
    const remito = remitos.find(candidate => String(candidate._id) === entry.remitoId);
    const line = remito?.lines[entry.line];
    if (!remito || !line) throw new HttpError("Una de las cantidades no corresponde a los remitos elegidos");
    const pending = pendingQtyOf(line, remito.status);
    if (entry.quantity > pending + 1e-9) throw new HttpError(`Del remito ${remito.number} quedan ${pending} ${line.unit || ""} de ${line.name || "un material"} por facturar`.replace("  ", " "));
  }
  if (!lines.length) throw new HttpError("Los remitos elegidos no tienen nada pendiente de facturar");
  // Sólo los remitos de los que se factura algo.
  const used = new Set(lines.map(entry => entry.remitoId));
  data.remitoIds = remitos.filter(remito => used.has(String(remito._id))).map(remito => remito._id);
  data.remitoLines = lines.map(entry => ({ ...entry, remitoId: new Types.ObjectId(entry.remitoId) }));
  return remitos;
}

/**
 * Suma (o resta, con `sign` −1) lo que factura una factura a los renglones de un
 * remito. Cada remito lleva un contador de versión: si otra factura lo tocó en el
 * medio, se vuelve a leer y se reintenta, así dos facturas a la vez no se pisan.
 */
async function moveInvoicedQty(invoiceId: unknown, remitoId: unknown, entries: RemitoInvoiceLine[], sign: 1 | -1) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const remito = await SalesRemito.findById(remitoId).lean<RemitoDoc>();
    if (!remito) throw new HttpError("Uno de los remitos no existe");
    const quantities = remito.lines.map(line => invoicedQtyOf(line, remito.status));
    for (const entry of entries) {
      const line = remito.lines[entry.line];
      if (!line) throw new HttpError(`El remito ${remito.number} no tiene ese renglón`);
      const next = round(quantities[entry.line] + sign * entry.quantity);
      if (sign > 0 && next > Number(line.quantity || 0) + 1e-9) {
        throw new HttpError(`Del remito ${remito.number} quedan ${pendingQtyOf(line, remito.status)} ${line.unit || ""} de ${line.name || "un material"} por facturar: otra factura lo tomó`.replace("  ", " "), 409);
      }
      quantities[entry.line] = Math.max(0, next);
    }
    const status = remitoBillingStatus(remito.lines.map((line, index) => ({ ...line, invoicedQty: quantities[index] })));
    const set: Record<string, unknown> = { status };
    quantities.forEach((quantity, index) => { set[`lines.${index}.invoicedQty`] = quantity; });
    const result = await SalesRemito.updateOne(
      { _id: remito._id, billingRev: remito.billingRev ?? { $in: [null, 0] }, status: { $ne: "anulado" } },
      { $set: set, $inc: { billingRev: 1 }, ...(sign > 0 ? { $addToSet: { invoiceIds: invoiceId } } : { $pull: { invoiceIds: invoiceId } }) },
    );
    if (result.modifiedCount === 1) return;
  }
  throw new HttpError("El remito se está facturando desde otro lado: probá de nuevo", 409);
}

function byRemito(lines: RemitoInvoiceLine[]) {
  const groups = new Map<string, RemitoInvoiceLine[]>();
  for (const entry of lines) groups.set(String(entry.remitoId), [...(groups.get(String(entry.remitoId)) || []), { ...entry, remitoId: String(entry.remitoId) }]);
  return groups;
}

/**
 * Toma los remitos para una factura nueva antes de guardarla: suma lo que
 * factura a cada renglón, sólo si sigue pendiente. Si dos facturas quieren lo
 * mismo a la vez, una lo consigue y la otra se frena acá. Si no se pudo tomar
 * alguno, se sueltan los que se habían tomado.
 */
export async function claimRemitos(invoiceId: unknown, lines: RemitoInvoiceLine[]) {
  const claimed: RemitoInvoiceLine[] = [];
  for (const [remitoId, entries] of byRemito(lines)) {
    try { await moveInvoicedQty(invoiceId, remitoId, entries, 1); }
    catch (error) { await unclaimRemitos(invoiceId, claimed); throw error; }
    claimed.push(...entries);
  }
}

/** Suelta lo que había tomado una factura: no se guardó, se anuló o se borró. */
export async function unclaimRemitos(invoiceId: unknown, lines: RemitoInvoiceLine[]) {
  for (const [remitoId, entries] of byRemito(lines)) await moveInvoicedQty(invoiceId, remitoId, entries, -1);
}

/** En una sustitución: los remitos de la X pasan a la fiscal, con las mismas cantidades. */
export async function attachRemitos(invoiceId: unknown, remitoIds: unknown[], replacedId?: unknown) {
  if (!remitoIds.length) return;
  if (replacedId) await SalesRemito.updateMany({ _id: { $in: remitoIds } }, { $pull: { invoiceIds: replacedId } });
  await SalesRemito.updateMany({ _id: { $in: remitoIds } }, { $addToSet: { invoiceIds: invoiceId } });
}

/** Las cantidades que factura una factura guardada, como las usa `unclaimRemitos`. */
export function invoiceRemitoLines(invoice: { remitoLines?: unknown }): RemitoInvoiceLine[] {
  return Array.isArray(invoice.remitoLines)
    ? (invoice.remitoLines as Array<{ remitoId: unknown; line: number; quantity: number }>).map(entry => ({ remitoId: String(entry.remitoId), line: Number(entry.line), quantity: Number(entry.quantity) }))
    : [];
}

/**
 * Una factura anulada o borrada devuelve lo que facturaba de sus remitos. Las de
 * antes no dicen cantidades: el remito vuelve a "pendiente de facturar", salvo
 * que otra factura vigente lo tenga.
 */
export async function releaseRemitos(invoice: { _id?: unknown; remitoLines?: unknown }) {
  const lines = invoiceRemitoLines(invoice);
  if (lines.length) return unclaimRemitos(invoice._id, lines);
  const remitos = await SalesRemito.find({ invoiceIds: invoice._id }).lean<Array<Lean & { invoiceIds: Types.ObjectId[] }>>();
  for (const remito of remitos) {
    const others = remito.invoiceIds.filter(other => String(other) !== String(invoice._id));
    const stillInvoiced = others.length ? await Invoice.exists({ _id: { $in: others }, status: { $nin: VOID_INVOICE_STATUSES } }) : null;
    await SalesRemito.updateOne({ _id: remito._id }, { $pull: { invoiceIds: invoice._id }, $inc: { billingRev: 1 }, ...(stillInvoiced ? {} : { $set: { status: "pendiente" }, $unset: { "lines.$[].invoicedQty": "" } }) });
  }
}

/** Los remitos con sus clientes, para la pantalla. */
export async function listSalesRemitos(filter: { status?: string; clientId?: string; kind?: string } = {}) {
  const query: Record<string, unknown> = {};
  if (filter.status) query.status = filter.status;
  if (filter.clientId) query.clientId = filter.clientId;
  if (filter.kind) query.kind = filter.kind;
  const remitos = await SalesRemito.find(query).sort({ createdAt: -1 }).limit(300).lean<Lean[]>();
  const [clients, invoices] = await Promise.all([
    Client.find({ _id: { $in: remitos.map(remito => remito.clientId) } }).select("name cuit address").lean<Lean[]>(),
    Invoice.find({ _id: { $in: remitos.flatMap(remito => (remito.invoiceIds as unknown[]) || []) } }).select("number voucherType status").lean<Lean[]>(),
  ]);
  const clientById = new Map(clients.map(client => [String(client._id), client]));
  const invoiceById = new Map(invoices.map(invoice => [String(invoice._id), invoice]));
  return remitos.map(remito => ({
    ...remito,
    client: clientById.get(String(remito.clientId)) || null,
    invoices: ((remito.invoiceIds as unknown[]) || []).map(invoiceId => invoiceById.get(String(invoiceId))).filter(Boolean),
  }));
}
