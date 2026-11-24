import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { changePurchaseSupplier } from "@/lib/purchase-flow";

const schema = z.object({ supplierId: z.string().trim().min(1, "Elegí el proveedor") });

/** Cambiar el proveedor de una compra emitida o aprobada, sin pagos ni facturas. Queda en el historial y en la bitácora. */
export async function POST(request: Request, context: RouteContext<"/api/purchases/[id]/supplier">) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const saved = await changePurchaseSupplier(id, parsed.data.supplierId, session);
    await audit(session, "change_purchase_supplier", "purchases", id, { supplier: saved.previous }, { supplier: saved.supplier }, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(saved);
  } catch (error) { return apiError(error); }
}
