import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { StockError } from "@/lib/stock-service";
import { ReceiptError } from "@/lib/receipt-service";
import { canSellAtCounter, counterDay, counterSaleSchema, registerCounterSale } from "@/lib/counter-sales";
import { todayIso } from "@/lib/format";

/**
 * El Mostrador (Ventas › Mostrador): la venta al público del Salón.
 * GET ?day=aaaa-mm-dd trae las ventas del día con su cierre; POST registra una
 * venta (remito, factura y recibo juntos). Ver src/lib/counter-sales.ts.
 */

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "invoices")) throw new Error("FORBIDDEN");
    const day = new URL(request.url).searchParams.get("day") || "";
    await connectDB();
    return Response.json(await counterDay(/^\d{4}-\d{2}-\d{2}$/.test(day) ? day : todayIso()));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canSellAtCounter(session)) throw new Error("FORBIDDEN");
    const parsed = counterSaleSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const result = await registerCounterSale(parsed.data, session, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof StockError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof ReceiptError) return Response.json({ error: error.message }, { status: 400 });
    return apiError(error);
  }
}
