import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Payment } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { paymentOrderPdfData, saveSupplierPayment, supplierPaymentSchema } from "@/lib/payment-order-service";

/** Cambia una orden de pago: deshace lo que había aplicado a cada comprobante y aplica lo nuevo. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "payments")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = supplierPaymentSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Orden de pago inválida" }, { status: 400 });
    await connectDB();
    const before = await Payment.findById(id).lean();
    const payment = await saveSupplierPayment(parsed.data, session, id);
    await audit(session, "update", "payments", id, before, payment, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ payment, pdf: await paymentOrderPdfData(id) });
  } catch (error) { return apiError(error); }
}
