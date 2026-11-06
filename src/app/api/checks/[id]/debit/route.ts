import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { debitOwnCheck, debitSchema } from "@/lib/check-service";

/** El banco debitó el cheque propio: pase del banco a su cuenta de cheques diferidos, y el cheque queda cobrado. */
export async function POST(request: Request, context: RouteContext<"/api/checks/[id]/debit">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "checks")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const parsed = debitSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const saved = await debitOwnCheck(id, parsed.data);
    await audit(session, "debit_check", "checks", id, null, saved, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(saved);
  } catch (error) { return apiError(error); }
}
