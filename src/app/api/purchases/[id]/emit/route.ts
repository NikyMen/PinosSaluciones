import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { emitRequest } from "@/lib/purchase-flow";

/** Emite la solicitud: queda en sólo lectura y, según el importe, autorizada o esperando autorización. */
export async function POST(request: Request, context: RouteContext<"/api/purchases/[id]/emit">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "purchases")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    await connectDB();
    const saved = await emitRequest(id, session);
    await audit(session, "emit_purchase_request", "purchases", id, null, saved, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(saved);
  } catch (error) { return apiError(error); }
}
