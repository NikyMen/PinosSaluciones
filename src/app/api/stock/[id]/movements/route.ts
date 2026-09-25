import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { StockItem } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { applyStockMovement, StockError, type MovementInput } from "@/lib/stock-service";
import { WAREHOUSE_KEYS } from "@/lib/warehouses";

/**
 * Un movimiento de stock sobre un material: entrada, salida a obra (de uno o
 * de los dos depósitos), pase entre depósitos o ajuste. Las cuentas y los
 * remitos están en src/lib/stock-service.ts.
 */
const warehouse = z.enum(WAREHOUSE_KEYS);
const amount = z.coerce.number().positive("La cantidad tiene que ser mayor a cero");
const common = { note: z.string().trim().max(1000).optional().default(""), date: z.coerce.date().optional() };
const objectId = z.string().refine(isValidObjectId, "ID inválido");
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ingreso"), warehouse: warehouse.default("central"), quantity: amount, unitCostCents: z.coerce.number().int().min(0).default(0), supplierId: z.union([objectId, z.literal("")]).optional().transform(value => value || undefined), reference: z.string().trim().max(120).optional().default(""), ...common }),
  z.object({ kind: z.literal("egreso"), workId: objectId, parts: z.array(z.object({ warehouse, quantity: z.coerce.number().min(0) })).min(1).max(10), reference: z.string().trim().max(120).optional().default(""), ...common }),
  z.object({ kind: z.literal("transferencia"), from: warehouse, to: warehouse, quantity: amount, ...common }),
  z.object({ kind: z.literal("ajuste"), warehouse, quantity: z.coerce.number().min(0, "La cantidad contada no puede ser negativa"), ...common }),
]);

export async function POST(request: Request, context: RouteContext<"/api/stock/[id]/movements">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });

    await connectDB();
    const item = await StockItem.findById(id);
    if (!item) return Response.json({ error: "Material no encontrado" }, { status: 404 });
    const before = item.toObject();
    const result = await applyStockMovement(item, parsed.data as MovementInput, session);
    await audit(session, `stock_${parsed.data.kind}`, "stock", item._id, before, result.item, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof StockError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
