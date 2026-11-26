import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { clientCredits } from "@/lib/credit-notes";

/**
 * Las notas de crédito con saldo a favor (?clientId= para las de un cliente):
 * lo que quedó sin aplicar a ninguna factura. Las usa el recibo y la lista
 * "A favor de clientes" de Facturas de venta.
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "invoices") && !canRead(session, "collections")) throw new Error("FORBIDDEN");
    const clientId = new URL(request.url).searchParams.get("clientId") || "";
    if (clientId && !isValidObjectId(clientId)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const items = await clientCredits(clientId || undefined);
    return Response.json({ items, totalCents: items.reduce((total, item) => total + item.creditCents, 0) });
  } catch (error) { return apiError(error); }
}
