import { z } from "zod";
import { HttpError } from "./api";
import { Purchase, PurchaseReceipt, Expense, Quote, Supplier, Work, nextPurchaseReceiptNumber } from "./models";
import type { Session } from "./auth";

const id = z.string().regex(/^[a-f\d]{24}$/i);

export const standaloneReceiptSchema = z.object({
  supplierId: id,
  workId: id.optional(),
  quoteId: id.optional(),
  supplierRemito: z.string().trim().min(1).max(60),
  date: z.iso.date(),
  lines: z.array(z.object({
    name: z.string().trim().min(1).max(300),
    quantity: z.number().positive().max(1e9),
    unit: z.string().trim().min(1).max(30),
  })).min(1).max(200),
  notes: z.string().trim().max(1000).optional(),
}).refine(value => value.workId || value.quoteId, "Elegí una cotización o una obra");

export async function registerStandaloneReceipt(input: z.infer<typeof standaloneReceiptSchema>, session: Session) {
  const [supplier, work, quote] = await Promise.all([
    Supplier.exists({ _id: input.supplierId }),
    input.workId ? Work.findById(input.workId).select("quoteId").lean<{ quoteId?: unknown }>() : null,
    input.quoteId ? Quote.exists({ _id: input.quoteId }) : null,
  ]);
  if (!supplier) throw new HttpError("El proveedor no existe");
  if (input.workId && !work) throw new HttpError("La obra no existe");
  if (input.quoteId && (!quote || (work && String(work.quoteId) !== input.quoteId))) throw new HttpError("La cotización no existe o no corresponde a la obra");
  return PurchaseReceipt.create({
    ...input, quoteId: input.quoteId || work?.quoteId, number: await nextPurchaseReceiptNumber(),
    date: new Date(input.date), userId: session.userId, userName: session.name,
    lines: input.lines.map((line, index) => ({ ...line, line: index })),
  });
}

/** Remitos que puede elegir una factura, incluidos los suyos cuando se edita. */
export async function purchaseInvoiceReceipts(supplierId: string, purchaseId: string, expenseId: string) {
  if (![supplierId, purchaseId, expenseId].every(value => !value || id.safeParse(value).success)) throw new HttpError("ID inválido");
  if (!supplierId) return [];
  if (purchaseId && !await Purchase.exists({ _id: purchaseId, supplierId })) throw new HttpError("La orden no pertenece al proveedor");
  const eligible = [{ supplierId, purchaseId: null }, ...(purchaseId ? [{ purchaseId }] : [])];
  const receipts = await PurchaseReceipt.find({ $or: eligible }).sort({ date: -1 }).lean<Array<{ _id: unknown }>>();
  const used = await Expense.find({
    purchaseReceiptIds: { $in: receipts.map(receipt => receipt._id) }, status: { $ne: "anulado" },
    ...(expenseId ? { _id: { $ne: expenseId } } : {}),
  }).select("purchaseReceiptIds").lean<Array<{ purchaseReceiptIds?: unknown[] }>>();
  const billed = new Set(used.flatMap(expense => expense.purchaseReceiptIds || []).map(String));
  return receipts.filter(receipt => !billed.has(String(receipt._id)));
}
