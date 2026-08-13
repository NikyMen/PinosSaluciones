import { Expense, Invoice } from "./models";

export async function applyInvoiceCollection(invoiceId: unknown, deltaCents: number) {
  if (!invoiceId || !deltaCents) return;
  const invoice = await Invoice.findByIdAndUpdate(invoiceId, { $inc: { collectedCents: deltaCents } }, { new: true });
  if (!invoice) return;
  invoice.collectedCents = Math.max(0, invoice.collectedCents);
  invoice.status = invoice.collectedCents >= invoice.amountCents ? "cobrada" : invoice.collectedCents > 0 ? "parcial" : "pendiente";
  await invoice.save();
}

export async function applyExpensePayment(expenseId: unknown, deltaCents: number) {
  if (!expenseId || !deltaCents) return;
  const expense = await Expense.findByIdAndUpdate(expenseId, { $inc: { paidCents: deltaCents } }, { new: true });
  if (!expense) return;
  expense.paidCents = Math.max(0, expense.paidCents);
  expense.status = expense.paidCents >= expense.amountCents ? "pagado" : expense.paidCents > 0 ? "parcial" : "pendiente";
  await expense.save();
}
