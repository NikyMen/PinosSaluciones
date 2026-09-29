import { Expense, Invoice } from "./models";

export async function applyInvoiceCollection(invoiceId: unknown, deltaCents: number) {
  if (!invoiceId || !deltaCents) return;
  const invoice = await Invoice.findByIdAndUpdate(invoiceId, { $inc: { collectedCents: deltaCents } }, { new: true });
  if (!invoice) return;
  invoice.collectedCents = Math.max(0, invoice.collectedCents);
  // Una factura anulada sigue anulada aunque se le mueva un cobro.
  if (invoice.status !== "anulada") invoice.status = invoice.collectedCents >= invoice.amountCents ? "cobrada" : invoice.collectedCents > 0 ? "parcial" : "pendiente";
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
