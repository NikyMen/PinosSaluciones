import { requireSession } from "@/lib/auth";
import { canViewSection } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { cashStatement } from "@/lib/cash-statement";
import { periodFrom } from "@/lib/period";

/** El extracto por caja: ?from=&to= y, opcional, ?codeFrom=&codeTo= (una caja o un rango de códigos). */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canViewSection(session, "cashAccounts") && !canViewSection(session, "accounting")) throw new Error("FORBIDDEN");
    await connectDB();
    const params = new URL(request.url).searchParams;
    const { from, to } = periodFrom(params);
    const code = (key: string) => { const value = Number(params.get(key) || ""); return Number.isInteger(value) && value > 0 ? value : undefined; };
    return Response.json({ accounts: await cashStatement({ from, to, codeFrom: code("codeFrom"), codeTo: code("codeTo") }) });
  } catch (error) { return apiError(error); }
}
