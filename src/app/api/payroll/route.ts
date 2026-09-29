import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { payroll } from "@/lib/payroll";

const day = /^\d{4}-\d{2}-\d{2}$/;

/** Liquidación de todas las obras entre dos fechas (?from=aaaa-mm-dd&to=aaaa-mm-dd). */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "workers")) throw new Error("FORBIDDEN");
    const params = new URL(request.url).searchParams;
    const from = params.get("from") || ""; const to = params.get("to") || "";
    if (!day.test(from) || !day.test(to) || from > to) return Response.json({ error: "Elegí el período a liquidar" }, { status: 400 });
    await connectDB();
    return Response.json(await payroll(new Date(`${from}T00:00:00.000Z`), new Date(`${to}T23:59:59.999Z`)));
  } catch (error) { return apiError(error); }
}
