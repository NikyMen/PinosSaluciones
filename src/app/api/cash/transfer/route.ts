import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { cashTransferSchema, createCashTransfer, knownCashAccounts } from "@/lib/cash-transfer";

/** Las cajas y cuentas bancarias ya usadas, para el formulario del pase. */
export async function GET() {
  try {
    const session = await requireSession();
    if (!canRead(session, "cash")) throw new Error("FORBIDDEN");
    await connectDB();
    return Response.json({ accounts: await knownCashAccounts() });
  } catch (error) { return apiError(error); }
}

/** Un pase entre cuentas propias: deja el egreso y el ingreso atados por el mismo identificador. */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "cash")) throw new Error("FORBIDDEN");
    const parsed = cashTransferSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const result = await createCashTransfer(parsed.data);
    const ip = request.headers.get("x-forwarded-for") || undefined;
    await audit(session, "create", "cash", result.out._id, null, result.out, ip);
    await audit(session, "create", "cash", result.into._id, null, result.into, ip);
    return Response.json(result, { status: 201 });
  } catch (error) { return apiError(error); }
}
