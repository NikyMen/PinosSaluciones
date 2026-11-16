import { Types } from "mongoose";
import { HttpError } from "./api";
import { checkWorkForAccount } from "./account-service";
import { companyOf } from "./companies";
import { Expense, Payment, Purchase, PurchaseReceipt, Quote, Work } from "./models";
import { refreshOrderPayment } from "./purchase-flow";
import { projectCategory } from "./work-categories";
import { canRead, canWrite } from "./permissions";
import type { Session } from "./auth";

type Doc = Record<string, unknown> & { _id: Types.ObjectId };
const orderFilter = { stage: { $ne: "solicitud" }, status: { $nin: ["anulada", "cancelada"] } };

export async function findExpense(id: string) {
  if (!Types.ObjectId.isValid(id)) throw new HttpError("ID inválido");
  const expense = await Expense.findById(id).lean<Doc>();
  if (!expense?.voucherType) throw new HttpError("Factura de compra no encontrada", 404);
  return expense;
}

async function associationOptions(expense: Doc) {
  if (expense.purchaseId || expense.status === "anulado") return { orders: [], quotes: [] };
  const orders = expense.supplierId ? await Purchase.find({ ...orderFilter, supplierId: expense.supplierId }).select("number description quoteId workId company").sort({ createdAt: -1 }).lean<Doc[]>() : [];
  const sameCompany = orders.filter(row => companyOf(row.company).key === companyOf(expense.company).key);
  const receipts = await PurchaseReceipt.find({ _id: { $in: expense.purchaseReceiptIds || [] } }).select("quoteId workId").lean<Doc[]>();
  const workIds = [expense.workId, ...sameCompany.map(order => order.workId), ...receipts.map(receipt => receipt.workId)].filter(Boolean);
  const works = await Work.find({ _id: { $in: workIds } }).select("quoteId").lean<Doc[]>();
  const quoteIds = [expense.quoteId, ...sameCompany.map(order => order.quoteId), ...receipts.map(receipt => receipt.quoteId), ...works.map(work => work.quoteId)].filter(Boolean);
  const quotes = await Quote.find({ $or: [{ _id: { $in: quoteIds } }, { workId: { $in: workIds } }] })
    .select("number title workId workCategoryId company").sort({ createdAt: -1 }).lean<Doc[]>();
  return { orders: sameCompany, quotes: quotes.filter(row => companyOf(row.company).key === companyOf(expense.company).key) };
}

export async function expenseLinks(expense: Doc, session: Session) {
  const order = expense.purchaseId && canRead(session, "purchases")
    ? await Purchase.findById(expense.purchaseId).select("number quoteId workId").lean<Doc>() : null;
  const workId = expense.workId || order?.workId;
  const work = workId && canRead(session, "works") ? await Work.findById(workId).select("code name quoteId").lean<Doc>() : null;
  const quoteId = expense.quoteId || order?.quoteId || work?.quoteId;
  const [quote, payments, receipts, options] = await Promise.all([
    quoteId && canRead(session, "quotes") ? Quote.findById(quoteId).select("number title").lean<Doc>() : null,
    canRead(session, "payments") ? Payment.find({ status: { $ne: "anulada" }, $or: [{ expenseId: expense._id }, { "allocations.expenseId": expense._id }] }).select("number").lean<Doc[]>() : [],
    canRead(session, "purchases") ? PurchaseReceipt.find({ _id: { $in: expense.purchaseReceiptIds || [] } }).select("number supplierRemito").lean<Doc[]>() : [],
    canWrite(session, "expenses") ? associationOptions(expense) : { orders: [], quotes: [] },
  ]);
  return { order, work, quote, payments, receipts, options };
}

export async function associateExpense(expense: Doc, kind: "purchase" | "quote", targetId: string) {
  if (expense.purchaseId || expense.status === "anulado") throw new HttpError("La factura ya tiene OC o está anulada", 409);
  const { orders, quotes } = await associationOptions(expense);
  const order = kind === "purchase" ? orders.find(row => String(row._id) === targetId) : undefined;
  const quote = kind === "quote" ? quotes.find(row => String(row._id) === targetId) : undefined;
  if (!order && !quote) throw new HttpError("Elegí una OC del proveedor o una cotización vinculada al proveedor o a la obra");
  const quoteId = order?.quoteId || quote?._id;
  const work = quoteId ? await Work.findOne({ quoteId }).select("_id").lean<Doc>() : null;
  const workId = order?.workId || quote?.workId || work?._id || expense.workId;
  if (expense.withRemito === undefined) await checkWorkForAccount(expense.accountId, workId);
  const changes = { purchaseId: order?._id || null, quoteId: quoteId || null, workId: workId || null, ...await projectCategory({ quoteId, workId }) };
  const after = await Expense.findOneAndUpdate(
    { _id: expense._id, purchaseId: null, status: { $ne: "anulado" }, updatedAt: expense.updatedAt },
    { $set: changes }, { returnDocument: "after", runValidators: true },
  ).lean<Doc>();
  if (!after) throw new HttpError("La factura cambió mientras la editabas. Actualizá y volvé a intentar.", 409);
  if (after.purchaseId) await refreshOrderPayment(after.purchaseId);
  return after;
}
