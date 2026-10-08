import { Types } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canApprovePurchases, canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { Expense, Payment, Purchase, PurchaseReceipt, Supplier, Work } from "@/lib/models";

type Lean = Record<string, unknown> & { _id: Types.ObjectId };

/**
 * Una compra de punta a punta: la solicitud, su orden de compra, las órdenes de
 * pago con sus comprobantes, los remitos y las facturas. Y qué puede hacer con
 * ella quien la mira.
 */
export async function GET(_request: Request, context: RouteContext<"/api/purchases/[id]/detail">) {
  try {
    const session = await requireSession();
    if (!canRead(session, "purchases")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!Types.ObjectId.isValid(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const purchase = await Purchase.findById(id).lean<Lean>();
    if (!purchase) return Response.json({ error: "No encontrada" }, { status: 404 });
    const request = purchase.stage === "solicitud" ? purchase : purchase.requestId ? await Purchase.findById(purchase.requestId).lean<Lean>() : null;
    const order = purchase.stage === "solicitud" ? (purchase.orderId ? await Purchase.findById(purchase.orderId).lean<Lean>() : null) : purchase;
    const [payments, receipts, expenses, supplier, work] = await Promise.all([
      order ? Payment.find({ purchaseId: order._id }).sort({ date: 1, createdAt: 1 }).lean<Lean[]>() : [],
      order ? PurchaseReceipt.find({ purchaseId: order._id }).sort({ date: 1, createdAt: 1 }).lean<Lean[]>() : [],
      order ? Expense.find({ purchaseId: order._id }).sort({ issueDate: 1 }).lean<Lean[]>() : [],
      purchase.supplierId ? Supplier.findById(purchase.supplierId).select("name cuit email phone bank cbu alias").lean<Lean>() : null,
      purchase.workId ? Work.findById(purchase.workId).select("code name").lean<Lean>() : null,
    ]);
    const committedCents = payments.filter(payment => payment.status !== "anulada").reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
    const total = Number((order || request)?.amountCents || 0);
    const live = (doc: Lean | null) => Boolean(doc) && !["anulada", "cancelada"].includes(String(doc!.status));
    return Response.json({
      request, order, payments, receipts, expenses, supplier, work,
      totals: { totalCents: total, paidCents: Number(order?.paidCents || 0), committedCents, withoutOrderCents: Math.max(0, total - committedCents), pendingCents: Math.max(0, total - Number(order?.paidCents || 0)) },
      can: {
        edit: canWrite(session, "purchases") && request?.status === "borrador" && !order,
        emit: canWrite(session, "purchases") && request?.status === "borrador",
        decide: canApprovePurchases(session) && request?.status === "pendiente_autorizacion",
        cancel: session.role === "gerencia" && (live(order) || (live(request) && request?.status !== "borrador")),
        paymentOrder: canWrite(session, "payments") && (order ? live(order) : request?.status === "autorizada") && total - committedCents > 100,
        receive: canWrite(session, "purchases") && canWrite(session, "stock") && Boolean(order) && live(order) && order!.status !== "cerrada",
        invoice: canWrite(session, "expenses") && Boolean(order) && live(order),
      },
    });
  } catch (error) { return apiError(error); }
}
