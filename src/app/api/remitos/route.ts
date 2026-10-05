import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { StockError } from "@/lib/stock-service";
import { createSalesRemito, listSalesRemitos, salesRemitoSchema } from "@/lib/sales-remitos";

/** Los remitos de venta (?status=pendiente para los que faltan facturar, ?clientId=). */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "stock")) throw new Error("FORBIDDEN");
    const params = new URL(request.url).searchParams;
    const clientId = params.get("clientId") || "";
    if (clientId && !isValidObjectId(clientId)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    return Response.json({ items: await listSalesRemitos({ status: params.get("status") || "", clientId, kind: params.get("kind") || "" }) });
  } catch (error) { return apiError(error); }
}

/** Remito de salida al cliente desde el Salón de Ventas: descuenta el stock del Salón. */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const parsed = salesRemitoSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const { remito, changed } = await createSalesRemito(parsed.data, session);
    const ip = request.headers.get("x-forwarded-for") || undefined;
    await audit(session, "create", "sales_remitos", remito._id, null, remito, ip);
    for (const entry of changed) await audit(session, "stock_venta", "stock", entry.item._id, entry.before, entry.after, ip);
    return Response.json(remito, { status: 201 });
  } catch (error) {
    if (error instanceof StockError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
