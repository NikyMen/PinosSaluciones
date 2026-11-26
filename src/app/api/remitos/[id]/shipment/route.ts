import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { StockError } from "@/lib/stock-service";
import { sendSaleShipment } from "@/lib/shipments";

const objectId = z.string().refine(isValidObjectId, "ID inválido");
const count = z.coerce.number().int().min(0).max(100000).optional();
const schema = z.object({
  destination: z.string().trim().min(2, "Poné a dónde va").max(300),
  receiver: z.string().trim().max(200).optional().default(""),
  carrier: z.string().trim().min(2, "Poné el transporte").max(120),
  packages: count, pallets: count,
  note: z.string().trim().max(1000).optional().default(""),
  lines: z.array(z.object({ itemId: objectId, declaredUnitCents: z.coerce.number().int().min(0) })).max(200).optional(),
});

/**
 * Manda por transporte (Correo Argentino, Mercado Libre, un expreso) lo que
 * salió con este remito de venta. Deja el remito de envío ENV-n con el valor
 * declarado y no mueve stock: el remito de venta ya lo bajó.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Lo despacha el depósito o quien vende.
    if (!canWrite(session, "stock") && !canWrite(session, "invoices")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const shipment = await sendSaleShipment(id, parsed.data, session);
    await audit(session, "create", "shipments", shipment._id as string, null, shipment, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(shipment, { status: 201 });
  } catch (error) {
    if (error instanceof StockError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
