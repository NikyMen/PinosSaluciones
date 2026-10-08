import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { StockError } from "@/lib/stock-service";
import { purchaseReceiptSchema, registerPurchaseReceipt } from "@/lib/purchase-flow";

/**
 * El remito del proveedor de una orden de compra: suma al stock lo que llegó (al
 * Central, o al Salón si se pidió para ahí). Puede ser parcial; el final cierra
 * la orden. Lo cargan Compras o el Depósito.
 */
export async function POST(request: Request, context: RouteContext<"/api/purchases/[id]/receive">) {
  try {
    const session = await requireSession();
    // Recibir mueve las dos cosas: la orden y el stock.
    if (!canWrite(session, "purchases") || !canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const parsed = purchaseReceiptSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message?.includes("central") ? "Toda compra entra al Depósito Central. Al Salón llega con una transferencia." : parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const result = await registerPurchaseReceipt(id, parsed.data, session);
    await audit(session, "purchase_receipt", "purchases", id, null, result.receipt, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof StockError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
