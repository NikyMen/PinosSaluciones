import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { carteraChecks } from "@/lib/check-service";

/** Los cheques de terceros en cartera, para endosar en una OP (?payment= suma los que ya endosó esa OP). */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "payments") && !canRead(session, "checks")) throw new Error("FORBIDDEN");
    const payment = new URL(request.url).searchParams.get("payment") || undefined;
    if (payment && !isValidObjectId(payment)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    return Response.json({ items: await carteraChecks(payment) });
  } catch (error) { return apiError(error); }
}
