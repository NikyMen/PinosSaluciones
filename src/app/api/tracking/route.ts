import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { trackingRows, unappliedAdvances } from "@/lib/tracking";

/** Cotización → obra → facturas → recibos, una línea por cotización. */
export async function GET() {
  try {
    const session = await requireSession();
    if (!canRead(session, "invoices")) throw new Error("FORBIDDEN");
    await connectDB();
    const [items, advances] = await Promise.all([trackingRows(), unappliedAdvances()]);
    return Response.json({ items, advances });
  } catch (error) { return apiError(error); }
}
