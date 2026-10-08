import { Types } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { Account, Expense, Payment, Purchase, Supplier } from "@/lib/models";
import { companyOf } from "@/lib/companies";
import { voucherLabels } from "@/lib/invoice-labels";
import type { PaymentOrderPdfData } from "@/lib/payment-order-pdf";

type Lean = Record<string, unknown> & { _id: Types.ObjectId };
const iso = (value: unknown) => value ? new Date(value as Date).toISOString() : undefined;

/** Los datos del PDF de una orden de pago: el proveedor, qué paga y de dónde sale. */
export async function GET(_request: Request, context: RouteContext<"/api/payments/[id]/document">) {
  try {
    const session = await requireSession();
    if (!canRead(session, "payments")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!Types.ObjectId.isValid(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const payment = await Payment.findById(id).lean<Lean>();
    if (!payment) return Response.json({ error: "No encontrada" }, { status: 404 });
    const [supplier, order, request, expense, account] = await Promise.all([
      payment.supplierId ? Supplier.findById(payment.supplierId).select("name cuit").lean<Lean>() : null,
      payment.purchaseId ? Purchase.findById(payment.purchaseId).select("number").lean<Lean>() : null,
      payment.requestId ? Purchase.findById(payment.requestId).select("number").lean<Lean>() : null,
      payment.expenseId ? Expense.findById(payment.expenseId).select("voucherType number").lean<Lean>() : null,
      payment.accountId ? Account.findById(payment.accountId).select("name").lean<Lean>() : null,
    ]);
    const data: PaymentOrderPdfData = {
      company: companyOf(payment.company).key, number: String(payment.number || ""), date: iso(payment.date) || new Date().toISOString(), dueDate: iso(payment.dueDate),
      status: String(payment.status || "pagada"),
      supplier: { name: String(supplier?.name || "Proveedor"), cuit: supplier?.cuit ? String(supplier.cuit) : undefined },
      orderNumber: order ? String(order.number) : undefined, requestNumber: request ? String(request.number) : undefined,
      invoiceLabel: expense ? `${voucherLabels[String(expense.voucherType)] || "Comprobante"} ${String(expense.number || "")}`.trim() : undefined,
      amountCents: Number(payment.amountCents || 0), retentionsCents: Number(payment.retentionsCents || 0),
      method: String(payment.method || ""), cashAccount: payment.account ? String(payment.account) : undefined, ledgerAccount: account ? String(account.name) : undefined,
      reference: payment.reference ? String(payment.reference) : undefined, notes: payment.notes ? String(payment.notes) : undefined,
      paidAt: iso(payment.paidAt), paidByName: payment.paidByName ? String(payment.paidByName) : undefined,
    };
    return Response.json(data);
  } catch (error) { return apiError(error); }
}
