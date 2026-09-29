import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { trackingRows } from "@/lib/tracking";

/** Cotización → obra → facturas → recibos, una línea por cotización. */
export async function GET() {
  try {
    const session = await requireSession();
    if (!canRead(session, "invoices")) throw new Error("FORBIDDEN");
    await connectDB();
    return Response.json({ items: await trackingRows() });
  } catch (error) { return apiError(error); }
}
