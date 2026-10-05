import { Counter, Expense, Invoice, Payment } from "./models";
import { VOID_INVOICE_STATUSES } from "./invoice-labels";

export async function applyInvoiceCollection(invoiceId: unknown, deltaCents: number) {
  if (!invoiceId || !deltaCents) return;
  const invoice = await Invoice.findByIdAndUpdate(invoiceId, { $inc: { collectedCents: deltaCents } }, { new: true });
  if (!invoice) return;
  invoice.collectedCents = Math.max(0, invoice.collectedCents);
  // Una factura anulada (o una X sustituida) sigue así aunque se le mueva un cobro.
  if (!VOID_INVOICE_STATUSES.includes(invoice.status)) invoice.status = invoice.collectedCents >= invoice.amountCents ? "cobrada" : invoice.collectedCents > 0 ? "parcial" : "pendiente";
  await invoice.save();
}

type CollectionLike = { invoiceId?: unknown; amountCents?: unknown; allocations?: unknown; [key: string]: unknown };

/** A qué facturas se aplica un cobro: las del recibo o, en un cobro viejo, su única factura. */
export function collectionAllocations(collection: CollectionLike) {
  if (Array.isArray(collection.allocations) && collection.allocations.length) {
    return (collection.allocations as Array<{ invoiceId: unknown; amountCents: unknown }>).map(allocation => ({ invoiceId: allocation.invoiceId, amountCents: Number(allocation.amountCents || 0) }));
  }
  return collection.invoiceId ? [{ invoiceId: collection.invoiceId, amountCents: Number(collection.amountCents || 0) }] : [];
}

/** Suma (1) o descuenta (-1) un cobro del saldo de cada factura a la que se aplica. */
export async function applyCollection(collection: CollectionLike | null | undefined, sign: 1 | -1) {
  if (!collection) return;
  for (const allocation of collectionAllocations(collection)) await applyInvoiceCollection(allocation.invoiceId, sign * allocation.amountCents);
}

export async function applyExpensePayment(expenseId: unknown, deltaCents: number) {
  if (!expenseId || !deltaCents) return;
  const expense = await Expense.findByIdAndUpdate(expenseId, { $inc: { paidCents: deltaCents } }, { new: true });
  if (!expense) return;
  expense.paidCents = Math.max(0, expense.paidCents);
  expense.status = expense.paidCents >= expense.amountCents ? "pagado" : expense.paidCents > 0 ? "parcial" : "pendiente";
  await expense.save();
}

/** Lo que un pago descuenta de su factura de compra: una orden de pago emitida o anulada todavía no paga nada. */
export function paidByPayment(payment: { status?: unknown; amountCents?: unknown; [key: string]: unknown } | null | undefined) {
  if (!payment) return 0;
  return payment.status === "emitida" || payment.status === "anulada" ? 0 : Number(payment.amountCents || 0);
}

/** Los pagos que cuentan como plata que salió: los de antes (sin estado) y los pagados. */
export const effectivePayments = { status: { $nin: ["emitida", "anulada"] } };

/** El próximo número de orden de pago: OP-1, OP-2… */
export async function nextPaymentOrderNumber() {
  if (!await Counter.exists({ _id: "payment_orders" })) {
    const [highest] = await Payment.aggregate([
      { $match: { number: /^OP-\d+$/ } },
      { $project: { seq: { $toInt: { $substr: ["$number", 3, -1] } } } },
      { $sort: { seq: -1 } }, { $limit: 1 },
    ]);
    await Counter.updateOne({ _id: "payment_orders" }, { $setOnInsert: { seq: highest?.seq || 0 } }, { upsert: true });
  }
  const counter = await Counter.findByIdAndUpdate("payment_orders", { $inc: { seq: 1 } }, { returnDocument: "after" });
  return `OP-${counter.seq}`;
}
