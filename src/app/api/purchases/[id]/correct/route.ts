import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { correctPurchase } from "@/lib/purchase-flow";

const schema = z.object({ reason: z.string().trim().min(3, "Poné qué hay que corregir").max(500) });

/** Corregir una compra emitida: quien la podría aprobar la anula y queda una solicitud nueva en borrador con los mismos datos. */
export async function POST(request: Request, context: RouteContext<"/api/purchases/[id]/correct">) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const draft = await correctPurchase(id, parsed.data.reason, session);
    await audit(session, "correct_purchase", "purchases", id, null, { reason: parsed.data.reason, draft: { _id: draft._id, number: draft.number } }, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ draft });
  } catch (error) { return apiError(error); }
}
