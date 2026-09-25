import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { createPurchaseOrder, PurchaseOrderError } from "@/lib/purchase-orders";
import { WAREHOUSE_KEYS } from "@/lib/warehouses";

const id = z.string().regex(/^[a-f\d]{24}$/i, "ID inválido");
const schema = z.object({
  supplierId: id,
  items: z.array(z.object({
    itemId: id,
    quantity: z.coerce.number().positive("Las cantidades tienen que ser mayores a cero").max(1_000_000),
  })).min(1, "El pedido está vacío").max(500),
  workId: z.union([id, z.literal("")]).optional().transform(value => value || undefined),
  expectedDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional().transform(value => value ? new Date(`${value}T00:00:00.000Z`) : undefined),
  notes: z.string().trim().max(1000).optional().default(""),
  deliverTo: z.enum([...WAREHOUSE_KEYS, "obra"]).optional().default("central"),
});

/** Cierra el pedido de un proveedor: crea la orden de compra y devuelve los datos para el PDF. */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "purchases")) throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Pedido inválido" }, { status: 400 });
    await connectDB();
    const { supplierId, items, workId, expectedDate, deliverTo, notes } = parsed.data;
    const result = await createPurchaseOrder({ supplierId, lines: items, workId, expectedDate, deliverTo, notes, session });
    await audit(session, "create", "purchases", result.purchase._id, null, result.purchase, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof PurchaseOrderError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
