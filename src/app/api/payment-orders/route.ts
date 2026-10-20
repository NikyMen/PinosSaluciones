import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { paymentOrderPdfData, pendingVouchers, saveSupplierPayment, supplierPaymentSchema } from "@/lib/payment-order-service";

/** Los comprobantes del proveedor con saldo, para armar la orden de pago (?supplierId=, y ?payment= al editar una). */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "payments")) throw new Error("FORBIDDEN");
    const params = new URL(request.url).searchParams;
    const supplierId = params.get("supplierId") || "";
    const payment = params.get("payment") || undefined;
    if (!isValidObjectId(supplierId) || (payment && !isValidObjectId(payment))) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    return Response.json({ items: await pendingVouchers(supplierId, payment) });
  } catch (error) { return apiError(error); }
}

/** Nueva orden de pago de Tesorería: número OP-n, paga las facturas elegidas y devuelve los datos del PDF. */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "payments")) throw new Error("FORBIDDEN");
    const parsed = supplierPaymentSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Orden de pago inválida" }, { status: 400 });
    await connectDB();
    const payment = await saveSupplierPayment(parsed.data, session);
    await audit(session, "create", "payments", payment._id, null, payment, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ payment, pdf: await paymentOrderPdfData(String(payment._id)) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
