import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { priceHistory } from "@/lib/price-list-service";

/** Los precios que tuvo un producto en cada lista del mismo proveedor. */
export async function GET(_request: Request, context: RouteContext<"/api/prices/[id]/history">) {
  try {
    const session = await requireSession();
    if (!canRead(session, "suppliers")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const items = await priceHistory(id);
    if (!items) return Response.json({ error: "Producto no encontrado" }, { status: 404 });
    return Response.json({ items });
  } catch (error) { return apiError(error); }
}
