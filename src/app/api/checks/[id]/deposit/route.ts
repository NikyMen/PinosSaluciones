import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { depositThirdPartyCheck, depositSchema } from "@/lib/check-service";

/** Se deposita el cheque de terceros: pase de Valores al Cobro al banco, y el cheque queda depositado. */
export async function POST(request: Request, context: RouteContext<"/api/checks/[id]/deposit">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "checks")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const parsed = depositSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const saved = await depositThirdPartyCheck(id, parsed.data);
    await audit(session, "deposit_check", "checks", id, null, saved, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(saved);
  } catch (error) { return apiError(error); }
}
