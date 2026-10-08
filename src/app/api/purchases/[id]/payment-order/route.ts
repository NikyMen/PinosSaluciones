import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { issuePaymentOrder, paymentOrderSchema } from "@/lib/purchase-flow";

/**
 * Tesorería emite la orden de pago de una solicitud autorizada (o de su OC). Con
 * la primera nace la orden de compra. Se paga en el momento o queda emitida con
 * su vencimiento.
 */
export async function POST(request: Request, context: RouteContext<"/api/purchases/[id]/payment-order">) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const parsed = paymentOrderSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const result = await issuePaymentOrder(id, parsed.data, session);
    const ip = request.headers.get("x-forwarded-for") || undefined;
    await audit(session, "create", "payments", result.payment._id, null, result.payment, ip);
    await audit(session, "issue_payment_order", "purchases", id, null, { order: (result.order as { number?: string } | null)?.number, payment: result.payment.number }, ip);
    return Response.json(result, { status: 201 });
  } catch (error) { return apiError(error); }
}
