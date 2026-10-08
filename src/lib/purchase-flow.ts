import { Types } from "mongoose";
import { z } from "zod";
import { Expense, Payment, Purchase, PurchaseReceipt, Supplier, nextPurchaseNumber, nextPurchaseReceiptNumber, nextRequestNumber } from "./models";
import { HttpError } from "./api";
import { money, qty } from "./format";
import { PURCHASE_APPROVAL_LIMIT_CENTS, type Role } from "./constants";
import { canApprovePurchases, canWrite } from "./permissions";
import { notify, usersWithAction } from "./notifications";
import { paidByPayment } from "./balances";
import { beforeCreate } from "./document-rules";
import { applyStockMovement, stockItemForPurchaseLine } from "./stock-service";
import type { CompanyKey } from "./companies";
import type { WarehouseKey } from "./warehouses";
import type { Session } from "./auth";
import { paymentTermLabels, requestStatusLabels } from "./purchase-flow-labels";

/*
 * El circuito de compras (requerimiento integral v4, punto 2, con lo acordado
 * en el grupo de PINO):
 *
 *  1. Compras arma la solicitud (SC-n) con su condición de compra. Mientras es
 *     borrador se edita; al emitirla queda en sólo lectura.
 *  2. Por debajo de $500.000 queda autorizada sola y pasa a Tesorería. Desde
 *     $500.000 (inclusive) la autoriza Gerencia o quien tenga el permiso
 *     "Autorizar compras" (Socio, Presidencia).
 *  3. Tesorería emite la orden de pago y, con la primera, nace la orden de
 *     compra (OC-n), atada a la solicitud. Una OC puede tener varias OP.
 *  4. Compras ve la OC, la OP y el comprobante, y carga los remitos del
 *     proveedor: suman al stock y el remito final cierra la orden.
 *
 * Una solicitud emitida sólo la anula Gerencia, con motivo.
 */

type Lean = Record<string, unknown> & { _id: Types.ObjectId };
type PurchaseLine = { code?: string; name: string; presentation?: string; minSale?: string; quantity: number; unitCents: number; receivedQty?: number };
type PurchaseDoc = Lean & {
  number: string; stage: string; status: string; company?: CompanyKey; supplierId?: Types.ObjectId; amountCents?: number;
  requestId?: Types.ObjectId; orderId?: Types.ObjectId; items?: PurchaseLine[]; paymentTerms?: string; termDays?: number;
  deliverTo?: string; stockedAt?: Date; receptionStatus?: string; paidCents?: number; userId?: Types.ObjectId;
};

/** Tolerancia por redondeo al comparar lo pagado con el total de la orden: un peso. */
const TOLERANCE_CENTS = 100;

export { orderStatusLabels, paymentTermLabels, requestStatusLabels } from "./purchase-flow-labels";

export function needsApproval(amountCents: number) {
  return Number(amountCents || 0) >= PURCHASE_APPROVAL_LIMIT_CENTS;
}

const history = (action: string, session: Session, note?: string) => ({ action, note, at: new Date(), userName: session.name });

async function load(id: string) {
  if (!Types.ObjectId.isValid(id)) throw new HttpError("ID inválido");
  const purchase = await Purchase.findById(id).lean<PurchaseDoc>();
  if (!purchase) throw new HttpError("Compra no encontrada", 404);
  return purchase;
}

/** La solicitud y la orden de un documento, sea cual sea el que se tocó. */
async function pair(purchase: PurchaseDoc) {
  if (purchase.stage === "solicitud") return { request: purchase, order: purchase.orderId ? await Purchase.findById(purchase.orderId).lean<PurchaseDoc>() : null };
  return { request: purchase.requestId ? await Purchase.findById(purchase.requestId).lean<PurchaseDoc>() : null, order: purchase };
}

/* ── 1 y 2: emitir y autorizar ─────────────────────────────────────────────── */

/** Emite la solicitud: queda en sólo lectura y, según el importe, autorizada o esperando autorización. */
export async function emitRequest(id: string, session: Session) {
  const request = await load(id);
  if (request.stage !== "solicitud") throw new HttpError("Sólo se emite una solicitud de compra");
  if (request.status !== "borrador") throw new HttpError(`La solicitud ${request.number} ya está ${requestStatusLabels[request.status]?.toLowerCase() || request.status}`, 409);
  if (!request.supplierId) throw new HttpError("Elegí el proveedor antes de emitirla: Tesorería le va a pagar a él");
  if (!(Number(request.amountCents) > 0)) throw new HttpError("Poné el importe de la solicitud (con IVA) antes de emitirla");
  const approval = needsApproval(Number(request.amountCents));
  const update = approval
    ? { status: "pendiente_autorizacion", emittedAt: new Date() }
    : { status: "autorizada", emittedAt: new Date(), approval: { at: new Date(), automatic: true, reason: `Menos de ${money(PURCHASE_APPROVAL_LIMIT_CENTS)}: no necesita autorización` } };
  const saved = await Purchase.findOneAndUpdate({ _id: request._id, status: "borrador" }, {
    $set: update, $push: { history: history(approval ? "Emitida: espera autorización" : "Emitida y autorizada sola por monto", session) },
  }, { returnDocument: "after" }).lean<PurchaseDoc>();
  if (!saved) throw new HttpError("La solicitud ya se emitió", 409);
  const supplier = await Supplier.findById(request.supplierId).select("name").lean<{ name?: string }>();
  if (approval) {
    await notify({
      title: `Autorizar la solicitud ${saved.number} por ${money(Number(saved.amountCents))}`,
      body: `${supplier?.name || "Proveedor"} · ${String(saved.description || "")}. La emitió ${session.name}.`,
      kind: "compra", href: `/app/purchases?ver=${saved._id}`, roles: ["gerencia"], userIds: await usersWithAction("approvePurchases"), event: "compra.autorizar", exception: true, dedupeKey: `purchase-approve-${saved._id}`,
    });
  } else await notifyTreasury(saved, supplier?.name);
  return saved;
}

async function notifyTreasury(request: PurchaseDoc, supplierName?: string) {
  await notify({
    title: `Solicitud ${request.number} autorizada: emitir la orden de pago`,
    body: `${supplierName || "Proveedor"} · ${money(Number(request.amountCents))} · ${paymentTermLabels[String(request.paymentTerms || "contado")]}${request.paymentTerms === "plazo" && request.termDays ? ` a ${request.termDays} días` : ""}.`,
    kind: "compra", href: `/app/purchases?ver=${request._id}`, roles: ["administracion"], event: "compra.tesoreria", dedupeKey: `purchase-treasury-${request._id}`,
  });
}

/** Gerencia (o quien tenga el permiso) autoriza o rechaza una solicitud desde el límite. Rechazar pide motivo. */
export async function decideRequest(id: string, input: { approve: boolean; reason?: string }, session: Session) {
  if (!canApprovePurchases(session)) throw new HttpError("Las solicitudes desde el límite las autoriza Gerencia o quien tenga el permiso Autorizar compras", 403);
  const request = await load(id);
  if (request.stage !== "solicitud" || request.status !== "pendiente_autorizacion") throw new HttpError(`La solicitud ${request.number} no está esperando autorización`, 409);
  const reason = String(input.reason || "").trim();
  if (!input.approve && reason.length < 3) throw new HttpError("Poné por qué se rechaza");
  const decision = { userId: session.userId, userName: session.name, at: new Date(), reason: reason || undefined };
  const saved = await Purchase.findOneAndUpdate({ _id: request._id, status: "pendiente_autorizacion" }, {
    $set: input.approve ? { status: "autorizada", approval: decision } : { status: "rechazada", rejection: decision },
    $push: { history: history(input.approve ? "Autorizada" : "Rechazada", session, reason || undefined) },
  }, { returnDocument: "after" }).lean<PurchaseDoc>();
  if (!saved) throw new HttpError("La solicitud ya se resolvió", 409);
  const supplier = await Supplier.findById(request.supplierId).select("name").lean<{ name?: string }>();
  if (input.approve) await notifyTreasury(saved, supplier?.name);
  else await notify({ title: `Solicitud ${saved.number} rechazada`, body: `${session.name}: ${reason}`, kind: "compra", href: `/app/purchases?ver=${saved._id}`, roles: ["compras"], userIds: request.userId ? [request.userId] : undefined, event: "compra.rechazada", dedupeKey: `purchase-rejected-${saved._id}` });
  return saved;
}

/* ── Anular ─────────────────────────────────────────────────────────────────── */

/**
 * Anula una solicitud (y su orden, si ya la tiene) o una orden. Sólo Gerencia,
 * con motivo. No se anula lo que ya tiene pagos ejecutados o mercadería
 * recibida: eso se resuelve con el proveedor (nota de crédito, devolución).
 * Las órdenes de pago emitidas sin pagar se anulan con ella.
 */
export async function cancelPurchase(id: string, reasonInput: string, session: Session) {
  if (session.role !== "gerencia") throw new HttpError("Una solicitud o una orden de compra emitida sólo la anula Gerencia", 403);
  const reason = String(reasonInput || "").trim();
  if (reason.length < 3) throw new HttpError("Poné el motivo de la anulación");
  const purchase = await load(id);
  if (purchase.status === "anulada" || purchase.status === "cancelada") throw new HttpError(`${purchase.number} ya está anulada`, 409);
  const { request, order } = await pair(purchase);
  if (order) {
    const paid = await Payment.exists({ purchaseId: order._id, status: { $nin: ["emitida", "anulada"] } });
    if (paid) throw new HttpError(`La orden ${order.number} ya tiene pagos hechos: no se anula`, 409);
    if (await PurchaseReceipt.exists({ purchaseId: order._id })) throw new HttpError(`La orden ${order.number} ya tiene mercadería recibida: no se anula`, 409);
  }
  const cancellation = { userId: session.userId, userName: session.name, at: new Date(), reason };
  const ids = [request?._id, order?._id].filter(Boolean);
  await Purchase.updateMany({ _id: { $in: ids } }, { $set: { status: "anulada", cancellation }, $push: { history: history("Anulada", session, reason) } });
  if (order) await Payment.updateMany({ purchaseId: order._id, status: "emitida" }, { $set: { status: "anulada", notes: `Anulada con la orden ${order.number}: ${reason}` } });
  await notify({ title: `${purchase.number} anulada`, body: `${session.name}: ${reason}`, kind: "compra", href: `/app/purchases?ver=${purchase._id}`, roles: ["compras", "administracion"], event: "compra.anulada" });
  return Purchase.find({ _id: { $in: ids } }).lean();
}

/* ── 3: la orden de pago genera la orden de compra ─────────────────────────── */

const id24 = z.string().regex(/^[a-f\d]{24}$/i);
export const paymentOrderSchema = z.object({
  amountCents: z.coerce.number().int().positive("Poné el importe de la orden de pago"),
  retentionsCents: z.coerce.number().int().min(0).default(0),
  date: z.string({ error: "Poné la fecha" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Poné la fecha"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform(value => value || undefined),
  method: z.enum(["transferencia", "efectivo", "cheque", "otro"], { error: "Elegí el medio de pago" }),
  accountId: id24.or(z.literal("")).optional().transform(value => value || undefined),
  cashAccountId: id24.or(z.literal("")).optional().transform(value => value || undefined),
  // Pagarla ahora (contado, anticipo) o dejarla emitida para pagarla al vencimiento.
  execute: z.boolean().default(false),
  reference: z.string().trim().max(200).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
  attachment: z.string().regex(/^\/api\/uploads\/[\w.-]+$/).or(z.literal("")).optional().transform(value => value || undefined),
});
export type PaymentOrderInput = z.infer<typeof paymentOrderSchema>;

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86400000);

/** Lo comprometido en órdenes de pago de una OC (todas las que no están anuladas). */
async function committedCents(orderId: unknown) {
  const payments = await Payment.find({ purchaseId: orderId, status: { $ne: "anulada" } }).select("amountCents").lean<Array<{ amountCents?: number }>>();
  return payments.reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
}

/** Crea la OC de una solicitud autorizada, una sola vez aunque dos personas emitan la OP a la vez. */
async function orderFor(request: PurchaseDoc, session: Session) {
  if (request.orderId) return Purchase.findById(request.orderId).lean<PurchaseDoc>();
  const orderId = new Types.ObjectId();
  const claimed = await Purchase.updateOne({ _id: request._id, orderId: { $exists: false } }, { $set: { orderId } });
  if (!claimed.modifiedCount) return Purchase.findById((await Purchase.findById(request._id).select("orderId").lean<{ orderId: unknown }>())?.orderId).lean<PurchaseDoc>();
  const copy = ["company", "supplierId", "workId", "quoteId", "quoteNumber", "neededBy", "priority", "description", "amountCents", "subtotalCents", "vatCents", "notes",
    "priceListId", "priceListDate", "deliverTo", "paymentTerms", "termDays", "requiresAdvance", "requestedDate", "expectedDate"];
  const data: Record<string, unknown> = Object.fromEntries(copy.filter(key => request[key] !== undefined).map(key => [key, request[key]]));
  const order = await Purchase.create({
    ...data, _id: orderId, number: await nextPurchaseNumber(), stage: "orden", status: "emitida", requestId: request._id,
    items: (request.items || []).map(line => ({ ...line, receivedQty: 0 })),
    userId: session.userId, userName: session.name,
    history: [history(`Generada con la orden de pago de Tesorería, desde la solicitud ${request.number}`, session)],
  });
  await Purchase.updateOne({ _id: request._id }, { $push: { history: history(`Orden de compra ${order.number}`, session) } });
  return order.toObject() as PurchaseDoc;
}

/**
 * Tesorería emite una orden de pago de una solicitud autorizada (o de una OC
 * que ya existe). Con la primera nace la OC. Se puede pagar en el momento
 * (contado, anticipo) o dejarla emitida con su vencimiento (cuenta corriente,
 * plazo). Nunca pasa del total de la orden.
 */
export async function issuePaymentOrder(id: string, input: PaymentOrderInput, session: Session) {
  if (!canWrite(session, "payments")) throw new HttpError("Las órdenes de pago las emite Tesorería", 403);
  const purchase = await load(id);
  const { request } = await pair(purchase);
  let order: PurchaseDoc | null = purchase.stage === "solicitud" ? null : purchase;
  if (purchase.stage === "solicitud") {
    if (purchase.status !== "autorizada") throw new HttpError(purchase.status === "pendiente_autorizacion" ? `La solicitud ${purchase.number} todavía no está autorizada` : `La solicitud ${purchase.number} está ${requestStatusLabels[purchase.status]?.toLowerCase() || purchase.status}`, 409);
    order = await orderFor(purchase, session);
  }
  if (!order) throw new HttpError("No se pudo generar la orden de compra");
  if (["anulada", "cancelada"].includes(order.status)) throw new HttpError(`La orden ${order.number} está anulada`, 409);
  const balance = Number(order.amountCents || 0) - await committedCents(order._id);
  if (input.amountCents > balance + TOLERANCE_CENTS) throw new HttpError(`A la orden ${order.number} le quedan ${money(Math.max(0, balance))} sin orden de pago (total ${money(Number(order.amountCents || 0))})`, 409);

  const date = new Date(`${input.date}T00:00:00.000Z`);
  const days = order.paymentTerms === "plazo" ? Number(order.termDays || 0) : order.paymentTerms === "cuenta_corriente" ? 30 : 0;
  const data: Record<string, unknown> = {
    company: order.company || "tvp", supplierId: order.supplierId, purchaseId: order._id, requestId: request?._id ?? order.requestId,
    status: input.execute ? "pagada" : "emitida", date, dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : days ? addDays(date, days) : undefined,
    amountCents: input.amountCents, retentionsCents: input.retentionsCents, method: input.method, accountId: input.accountId, cashAccountId: input.cashAccountId,
    reference: input.reference, notes: input.notes, attachment: input.attachment,
    ...(input.execute ? { paidAt: new Date(), paidByName: session.name } : {}),
  };
  // Las mismas reglas que una OP cargada a mano: cuenta del plan, caja del maestro para pagarla, número OP-n.
  await beforeCreate("payments", data, session);
  const payment = await Payment.create(data);
  await refreshOrderPayment(order._id);
  await notifyPurchasing(order, payment.toObject() as Lean, session);
  return { order: await Purchase.findById(order._id).lean(), payment: payment.toObject() };
}

/** Compras se entera de la OP y del pago, con el link a la OC. */
async function notifyPurchasing(order: PurchaseDoc, payment: Lean, session: Session) {
  const paid = payment.status !== "emitida" && payment.status !== "anulada";
  await notify({
    title: paid ? `Pago ${String(payment.number)} de la orden ${order.number}` : `Orden de compra ${order.number} con la orden de pago ${String(payment.number)}`,
    body: `${money(Number(payment.amountCents || 0))} · ${paid ? `pagado por ${session.name}${payment.attachment ? ", con comprobante" : ""}` : `vence ${payment.dueDate ? new Date(payment.dueDate as Date).toLocaleDateString("es-AR") : "sin fecha"}`}. ${order.receptionStatus === "recibida" ? "" : "Ya se puede recibir la mercadería."}`.trim(),
    kind: "compra", href: `/app/purchases?ver=${order._id}`, roles: ["compras"], event: "compra.pago", dedupeKey: `purchase-payment-${String(payment._id)}-${paid ? "pagada" : "emitida"}`,
  });
}

/** Lo pagado de una OC y su estado de pago: todas las OP ejecutadas atadas a ella (directas o por sus facturas). */
export async function refreshOrderPayment(orderId: unknown) {
  if (!orderId) return;
  const order = await Purchase.findById(orderId).select("amountCents stage").lean<{ amountCents?: number; stage?: string }>();
  if (!order || order.stage === "solicitud") return;
  const payments = await Payment.find({ purchaseId: orderId }).select("status amountCents").lean<Array<{ status?: string; amountCents?: number }>>();
  const paidCents = payments.reduce((total, payment) => total + paidByPayment(payment), 0);
  const total = Number(order.amountCents || 0);
  const paymentStatus = paidCents > 0 && paidCents >= total - TOLERANCE_CENTS ? "pagada" : paidCents > 0 ? "parcial" : "pendiente";
  await Purchase.updateOne({ _id: orderId }, { $set: { paidCents, paymentStatus } });
}

/**
 * Antes de guardar una OP cargada a mano: si paga una factura de una OC, queda
 * atada también a esa OC. Después de guardarla (o borrarla) se recalcula lo
 * pagado de las órdenes que tocó, y Compras se entera del pago.
 */
export async function preparePaymentOrder(data: Record<string, unknown>, before: Record<string, unknown> = {}) {
  const expenseId = data.expenseId ?? before.expenseId;
  if (!data.purchaseId && !before.purchaseId && expenseId) {
    const expense = await Expense.findById(expenseId).select("purchaseId").lean<{ purchaseId?: unknown }>();
    if (expense?.purchaseId) data.purchaseId = expense.purchaseId;
  }
}

export async function afterPaymentChange(before: Record<string, unknown> | null, after: Record<string, unknown> | null, session: Session) {
  const orders = new Set([before?.purchaseId, after?.purchaseId].filter(Boolean).map(String));
  for (const orderId of orders) await refreshOrderPayment(orderId);
  const nowPaid = after && paidByPayment(after) > 0 && !(before && paidByPayment(before) > 0);
  if (nowPaid && after?.purchaseId) {
    if (!after.paidAt) await Payment.updateOne({ _id: after._id }, { $set: { paidAt: new Date(), paidByName: session.name } });
    const order = await Purchase.findById(after.purchaseId).lean<PurchaseDoc>();
    if (order) await notifyPurchasing(order, after as Lean, session);
  }
}

/* ── 4: los remitos del proveedor ───────────────────────────────────────────── */

export const purchaseReceiptSchema = z.object({
  supplierRemito: z.string().trim().max(60).optional().default(""),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Sin renglones: llega todo lo que falta.
  lines: z.array(z.object({ line: z.coerce.number().int().min(0), quantity: z.coerce.number().min(0) })).max(300).optional(),
  status: z.enum(["conforme", "observada"]).default("conforme"),
  final: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional().default(""),
  attachment: z.string().regex(/^\/api\/uploads\/[\w.-]+$/).or(z.literal("")).optional().transform(value => value || undefined),
  // Compatibilidad con "Pasar a stock": toda compra entra al Central (o al Salón, si se pidió para ahí).
  warehouse: z.literal("central").optional(),
});
export type PurchaseReceiptInput = z.infer<typeof purchaseReceiptSchema>;

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * El remito del proveedor de una OC: suma al stock lo que llegó de cada renglón
 * (al Central, o al Salón si se pidió para ahí). Puede ser parcial; el remito
 * final cierra la orden. Una orden sin renglones (cargada a mano) registra el
 * remito sin mover stock: la mercadería se suma desde Stock.
 */
export async function registerPurchaseReceipt(id: string, input: PurchaseReceiptInput, session: Session) {
  const order = await load(id);
  if (order.stage === "solicitud") throw new HttpError(order.orderId ? "El remito se carga en la orden de compra de esta solicitud" : `La solicitud ${order.number} todavía no tiene orden de compra: la genera Tesorería con la orden de pago`, 409);
  if (["anulada", "cancelada"].includes(order.status)) throw new HttpError(`La orden ${order.number} está anulada`, 409);
  if (order.status === "cerrada") throw new HttpError(`La orden ${order.number} ya está cerrada: llegó el remito final`, 409);
  const items = order.items || [];
  const warehouse: WarehouseKey = order.deliverTo === "salon" ? "salon" : "central";
  const received = items.map(line => Number(line.receivedQty || 0));
  const requested = input.lines ?? items.map((line, index) => ({ line: index, quantity: round(Math.max(0, Number(line.quantity || 0) - received[index])) }));
  const moves = requested.filter(entry => entry.quantity > 0);
  for (const entry of moves) {
    const line = items[entry.line];
    if (!line) throw new HttpError("Uno de los renglones no es de esta orden");
    const pending = round(Number(line.quantity || 0) - received[entry.line]);
    if (entry.quantity > pending + 1e-9) throw new HttpError(`De ${line.name} faltan recibir ${qty(pending)}: no pueden llegar ${qty(entry.quantity)}`);
  }
  if (items.length && !moves.length && !input.final) throw new HttpError("Poné cuánto llegó de cada producto");

  // Se toman las cantidades antes de mover el stock: dos remitos a la vez no suman lo mismo dos veces.
  const filter: Record<string, unknown> = { _id: order._id, status: { $nin: ["cerrada", "anulada"] } };
  const inc: Record<string, number> = {};
  for (const entry of moves) { filter[`items.${entry.line}.receivedQty`] = order.items?.[entry.line]?.receivedQty ?? { $in: [null, 0] }; inc[`items.${entry.line}.receivedQty`] = entry.quantity; }
  const after = received.map((value, index) => round(value + moves.filter(entry => entry.line === index).reduce((total, entry) => total + entry.quantity, 0)));
  const complete = items.length > 0 && items.every((line, index) => after[index] >= Number(line.quantity || 0) - 1e-9);
  const receptionStatus = complete || (!items.length && input.final) ? "recibida" : "parcial";
  const close = input.final || complete;
  const claimed = await Purchase.updateOne(filter, {
    ...(Object.keys(inc).length ? { $inc: inc } : {}),
    $set: { receptionStatus, receivedDate: new Date(), ...(order.stockedAt ? {} : { stockedAt: new Date(), stockedWarehouse: warehouse, stockedByName: session.name }), ...(close ? { status: "cerrada", closedAt: new Date() } : {}) },
  });
  if (!claimed.modifiedCount) throw new HttpError("Otro remito de esta orden se cargó al mismo tiempo: volvé a abrirla y probá de nuevo", 409);

  const number = await nextPurchaseReceiptNumber();
  const lines: Array<Record<string, unknown>> = [];
  for (const entry of moves) {
    const line = items[entry.line];
    const { item } = await stockItemForPurchaseLine(line, order);
    await applyStockMovement(item, {
      kind: "ingreso", warehouse, quantity: entry.quantity, unitCostCents: Number(line.unitCents || 0), owner: (order.company || "tvp") as CompanyKey,
      supplierId: order.supplierId ? String(order.supplierId) : undefined, reference: input.supplierRemito || order.number,
      note: `Remito ${input.supplierRemito || number} de la orden ${order.number}`, purchaseId: String(order._id),
    }, session);
    lines.push({ line: entry.line, name: line.name, unit: String(item.unit || ""), quantity: entry.quantity, unitCents: line.unitCents, stockItemId: item._id });
  }
  const receipt = await PurchaseReceipt.create({
    number, purchaseId: order._id, company: order.company, supplierId: order.supplierId, supplierRemito: input.supplierRemito,
    date: input.date ? new Date(`${input.date}T00:00:00.000Z`) : new Date(), warehouse, lines, status: input.status, final: close,
    attachment: input.attachment, notes: input.notes, userId: session.userId, userName: session.name,
  });
  await Purchase.updateOne({ _id: order._id }, { $push: { history: history(`Remito ${input.supplierRemito || number}${close ? " (final: orden cerrada)" : ""}`, session, input.status === "observada" ? input.notes : undefined) } });
  if (input.status === "observada") await notify({ title: `Remito observado de la orden ${order.number}`, body: input.notes || "Llegó con diferencias", kind: "compra", href: `/app/purchases?ver=${order._id}`, roles: ["compras", "administracion"], event: "compra.remito_observado" });
  return { receipt: receipt.toObject(), order: await Purchase.findById(order._id).lean(), warehouse };
}

/* ── Reglas de los cambios a mano ───────────────────────────────────────────── */

/** Lo que el sistema escribe solo y no se toca desde el formulario. */
const SYSTEM_FIELDS = ["stage", "status", "number", "legacyNumber", "requestId", "orderId", "emittedAt", "approval", "rejection", "cancellation", "paidCents", "paymentStatus", "receptionStatus", "closedAt", "history", "stockedAt", "stockedWarehouse", "stockedByName"];
/** De una orden emitida se puede retocar sólo la entrega esperada y las notas. */
const ORDER_EDITABLE = ["expectedDate", "notes", "receiptNotes"];

/** Una solicitud nueva siempre arranca como borrador, con su número SC-n. */
export async function prepareNewRequest(data: Record<string, unknown>, session: Session) {
  for (const key of SYSTEM_FIELDS) delete data[key];
  Object.assign(data, { stage: "solicitud", status: "borrador", number: await nextRequestNumber(), userId: session.userId, userName: session.name, history: [history("Creada", session)] });
}

/** Una solicitud emitida queda en sólo lectura; una orden, salvo la entrega esperada y las notas. */
export function checkPurchaseChanges(before: Record<string, unknown>, changes: Record<string, unknown>) {
  for (const key of SYSTEM_FIELDS) delete changes[key];
  if (before.stage === "solicitud" && before.status === "borrador") return;
  const allowed = before.stage === "solicitud" ? ["notes"] : ORDER_EDITABLE;
  const blocked = Object.keys(changes).filter(key => !allowed.includes(key) && String(changes[key] ?? "") !== String(before[key] ?? ""));
  if (blocked.length) throw new HttpError(before.stage === "solicitud"
    ? `La solicitud ${String(before.number)} ya se emitió: queda en sólo lectura. Si hay que cambiarla, Gerencia la anula y se hace una nueva.`
    : `La orden ${String(before.number)} ya está emitida: sólo se cambian la entrega esperada y las notas`, 409);
  for (const key of Object.keys(changes)) if (!allowed.includes(key)) delete changes[key];
}

/** Sólo se borra una solicitud en borrador; lo emitido se anula. */
export function checkPurchaseDelete(before: Record<string, unknown>) {
  if (!(before.stage === "solicitud" && before.status === "borrador")) throw new HttpError(`${String(before.number)} ya se emitió: no se borra, Gerencia la anula con motivo`, 409);
}

/** Tesorería (Administración) y Gerencia cargan cualquier factura de compra; Compras, las de compras por debajo del límite. */
export async function checkExpenseLimit(data: Record<string, unknown>, before: Record<string, unknown>, role: Role) {
  if (role === "gerencia" || role === "administracion") return;
  const merged = { ...before, ...data };
  const order = merged.purchaseId ? await Purchase.findById(merged.purchaseId).select("amountCents number").lean<{ amountCents?: number; number?: string }>() : null;
  const amount = order ? Number(order.amountCents || 0) : Number(merged.amountCents || 0);
  if (needsApproval(amount)) throw new HttpError(`${order ? `La orden ${order.number} es` : "La factura es"} de ${money(amount)}: las facturas de compras desde ${money(PURCHASE_APPROVAL_LIMIT_CENTS)} las carga Tesorería`, 403);
}
