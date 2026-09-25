import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { PurchaseStockError, receivePurchase, StockError } from "@/lib/stock-service";
import { WAREHOUSE_KEYS } from "@/lib/warehouses";

const schema = z.object({ warehouse: z.enum(WAREHOUSE_KEYS) });

/** Llegó la mercadería de una orden de compra: sus productos suman al depósito elegido. */
export async function POST(request: Request, context: RouteContext<"/api/purchases/[id]/receive">) {
  try {
    const session = await requireSession();
    // Pasar a stock mueve las dos cosas: la orden queda recibida y el stock sube.
    if (!canWrite(session, "purchases") || !canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Elegí a qué depósito entra la mercadería" }, { status: 400 });
    await connectDB();
    const result = await receivePurchase(id, parsed.data.warehouse, session);
    await audit(session, "purchase_to_stock", "purchases", id, null, result, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof PurchaseStockError || error instanceof StockError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
