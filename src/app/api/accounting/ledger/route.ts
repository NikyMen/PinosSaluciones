import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canViewSection } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { ledgerMovements, ledgerSummary } from "@/lib/accounting";
import { periodFrom } from "@/lib/period";

/** Movimientos por cuenta del plan. Con ?accountId= devuelve el detalle de esa cuenta; con ?accountId=none, lo que quedó sin cuenta. */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canViewSection(session, "accounting")) throw new Error("FORBIDDEN");
    await connectDB();
    const params = new URL(request.url).searchParams;
    const period = periodFrom(params);
    const accountId = params.get("accountId") || "";
    if (accountId === "none") return Response.json({ items: (await ledgerMovements(period)).filter(movement => !movement.accountId) });
    if (accountId) {
      if (!isValidObjectId(accountId)) return Response.json({ error: "ID inválido" }, { status: 400 });
      return Response.json({ items: await ledgerMovements(period, accountId) });
    }
    return Response.json(await ledgerSummary(period));
  } catch (error) { return apiError(error); }
}
