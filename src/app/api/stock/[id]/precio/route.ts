import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { salePriceHistory, setSalePrice } from "@/lib/sale-prices";

/**
 * El precio de venta sin IVA de un material.
 * GET: su historial (quién lo cambió, cuándo, de cuánto a cuánto).
 * PUT { salePriceCents, source? }: lo guarda (desde el Mostrador, botón Guardar).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canRead(session, "stock")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    await connectDB();
    return Response.json({ items: await salePriceHistory(id) });
  } catch (error) { return apiError(error); }
}

const schema = z.object({
  salePriceCents: z.coerce.number().int().positive("Poné un precio mayor a cero"),
  source: z.enum(["stock", "mostrador"]).default("mostrador"),
});

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const { before, salePriceCents } = await setSalePrice(id, parsed.data.salePriceCents, session, parsed.data.source);
    await audit(session, "update", "stock", id, { salePriceCents: before.salePriceCents }, { salePriceCents }, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ _id: id, salePriceCents });
  } catch (error) { return apiError(error); }
}
