import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { cancelPurchase } from "@/lib/purchase-flow";

const schema = z.object({ reason: z.string().trim().min(3, "Poné el motivo de la anulación").max(500) });

/** Anular una solicitud o una orden de compra emitida: sólo Gerencia, con motivo. Queda en la bitácora. */
export async function POST(request: Request, context: RouteContext<"/api/purchases/[id]/cancel">) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const saved = await cancelPurchase(id, parsed.data.reason, session);
    await audit(session, "cancel_purchase", "purchases", id, null, { reason: parsed.data.reason, items: saved }, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ items: saved });
  } catch (error) { return apiError(error); }
}
