import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Asset } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { applyAssetAction, AssetError, type AssetAction } from "@/lib/asset-service";

/**
 * El mantenimiento de un bien de uso: lo que se le hizo y lo que toca hacerle.
 * GET trae el bien entero (el listado no trae ni el historial ni lo programado).
 * Las cuentas y los avisos están en src/lib/asset-service.ts.
 */
const objectId = z.string().refine(isValidObjectId, "ID inválido");
const optionalNumber = z.union([z.literal(""), z.null(), z.coerce.number().min(0)]).optional().transform(value => value === "" || value === null ? undefined : value);
const optionalDate = z.union([z.literal(""), z.null(), z.coerce.date()]).optional().transform(value => value || undefined);
const shortText = z.string().trim().max(1000).optional().default("");
const next = z.object({
  title: z.string().trim().min(1, "Poné qué hay que hacer").max(200),
  dueDate: optionalDate, dueReading: optionalNumber,
  intervalMonths: optionalNumber, intervalReading: optionalNumber, notes: shortText,
});
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("service"), date: z.coerce.date(),
    kind: z.enum(["service", "preventivo", "reparacion", "inspeccion", "otro"]).default("service"),
    description: z.string().trim().min(1, "Contá qué se le hizo").max(500),
    costCents: z.coerce.number().int().min(0).default(0), reading: optionalNumber,
    provider: shortText, notes: shortText, createExpense: z.boolean().optional().default(false),
    planId: z.union([objectId, z.literal("")]).optional().transform(value => value || undefined),
    next: next.optional(),
  }),
  next.extend({ action: z.literal("plan") }),
  z.object({ action: z.literal("cancel_plan"), planId: objectId }),
  z.object({ action: z.literal("reading"), reading: z.coerce.number().min(0), date: optionalDate }),
]);

export async function GET(_request: Request, context: RouteContext<"/api/assets/[id]/maintenance">) {
  try {
    const session = await requireSession();
    if (!canRead(session, "assets")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const asset = await Asset.findById(id).lean();
    if (!asset) return Response.json({ error: "Bien no encontrado" }, { status: 404 });
    return Response.json(asset);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: RouteContext<"/api/assets/[id]/maintenance">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "assets")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const before = await Asset.findById(id).lean();
    if (!before) return Response.json({ error: "Bien no encontrado" }, { status: 404 });
    const result = await applyAssetAction(id, parsed.data as AssetAction, session);
    await audit(session, `asset_${parsed.data.action}`, "assets", id, before, result.asset, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AssetError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
