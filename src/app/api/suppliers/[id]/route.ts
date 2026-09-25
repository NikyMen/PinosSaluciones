import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Supplier } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";

const schema = z.object({ discountPct: z.coerce.number().min(0, "El descuento no puede ser negativo").max(100, "El descuento no puede pasar el 100%") });

/**
 * Cambiar el descuento acordado desde la pantalla de listas. Toca sólo ese
 * campo: los precios no se reescriben, se recalculan al mostrarlos.
 */
export async function PATCH(request: Request, context: RouteContext<"/api/suppliers/[id]">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "suppliers")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Descuento inválido" }, { status: 400 });
    await connectDB();
    const before = await Supplier.findById(id).select("discountPct").lean() as { discountPct?: number } | null;
    if (!before) return Response.json({ error: "Proveedor no encontrado" }, { status: 404 });
    const discountPct = Math.round(parsed.data.discountPct * 100) / 100;
    await Supplier.updateOne({ _id: id }, { $set: { discountPct } });
    await audit(session, "update", "suppliers", id, { discountPct: before.discountPct ?? 0 }, { discountPct }, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ discountPct });
  } catch (error) { return apiError(error); }
}
