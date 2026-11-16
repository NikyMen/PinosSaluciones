import { Expense, Invoice } from "./models";
import { CREDIT_NOTE_TYPES, VOID_INVOICE_STATUSES } from "./invoice-labels";

type InvoiceEntity = "expenses" | "invoices";

const invoiceFilter = (entity: InvoiceEntity) => ({
  ...(entity === "expenses" ? { voucherType: { $exists: true, $nin: [null, "", ...CREDIT_NOTE_TYPES] } } : {}),
  status: { $nin: entity === "expenses" ? ["anulado", "anulada", "sustituida"] : VOID_INVOICE_STATUSES },
});

const balance = (entity: InvoiceEntity) => ({
  $subtract: [{ $ifNull: ["$amountCents", 0] }, { $ifNull: [entity === "expenses" ? "$paidCents" : "$collectedCents", 0] }],
});

export function pendingInvoiceFilter(entity: InvoiceEntity) {
  return { ...invoiceFilter(entity), $expr: { $gt: [balance(entity), 0] } };
}

export async function invoiceListSummary(entity: InvoiceEntity) {
  const model = entity === "expenses" ? Expense : Invoice;
  const [summary] = await model.aggregate<{ count: number; pendingCount: number; pendingCents: number }>([
    { $match: invoiceFilter(entity) },
    { $project: { balance: balance(entity) } },
    { $group: { _id: null, count: { $sum: 1 }, pendingCount: { $sum: { $cond: [{ $gt: ["$balance", 0] }, 1, 0] } }, pendingCents: { $sum: { $max: [0, "$balance"] } } } },
    { $project: { _id: 0 } },
  ]);
  return summary || { count: 0, pendingCount: 0, pendingCents: 0 };
}
