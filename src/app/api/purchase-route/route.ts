import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { purchaseRoute } from "@/lib/purchase-route";

/** La ruta de compras: solicitud → orden → recepción → factura → orden de pago → pago, y lo que quedó sin vínculo. */
export async function GET() {
  try {
    const session = await requireSession();
    if (!canRead(session, "purchases")) throw new Error("FORBIDDEN");
    await connectDB();
    return Response.json(await purchaseRoute());
  } catch (error) { return apiError(error); }
}
