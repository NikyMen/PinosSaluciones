import { Types } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { paymentOrderPdfData } from "@/lib/payment-order-service";

/** Los datos del PDF de una orden de pago: el proveedor, qué paga y de dónde sale. */
export async function GET(_request: Request, context: RouteContext<"/api/payments/[id]/document">) {
  try {
    const session = await requireSession();
    if (!canRead(session, "payments")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!Types.ObjectId.isValid(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const data = await paymentOrderPdfData(id);
    if (!data) return Response.json({ error: "No encontrada" }, { status: 404 });
    return Response.json(data);
  } catch (error) { return apiError(error); }
}
