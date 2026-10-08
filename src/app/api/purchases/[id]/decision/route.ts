import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { decideRequest } from "@/lib/purchase-flow";

const schema = z.object({ approve: z.boolean(), reason: z.string().trim().max(500).optional().default("") });

/** Autorizar o rechazar (con motivo) una solicitud desde el límite: Gerencia o quien tenga el permiso Autorizar compras. */
export async function POST(request: Request, context: RouteContext<"/api/purchases/[id]/decision">) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });
    await connectDB();
    const saved = await decideRequest(id, parsed.data, session);
    await audit(session, parsed.data.approve ? "approve_purchase_request" : "reject_purchase_request", "purchases", id, null, saved, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(saved);
  } catch (error) { return apiError(error); }
}
