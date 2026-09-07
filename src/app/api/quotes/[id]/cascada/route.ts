import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Quote } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { cascadaPayload } from "@/lib/schemas";
import { computeCascade } from "@/lib/cascada";

/**
 * Guarda el analisis de precios, los gastos generales y los porcentajes de la
 * cascada, y de ahi saca el precio.
 *
 * La cascada se recalcula SIEMPRE en el servidor: los totales que manda la
 * pantalla son para que el usuario vea el numero mientras tipea, no para
 * guardarlos. El precio y el costo se escriben en amountCents y
 * estimatedCostCents, que son los campos que ya leen el listado, el tablero,
 * los reportes y el pase a obra.
 */

// Una cotizacion ya aprobada tiene un precio que alguien acepto: si el costo se
// mueve por debajo, nadie se entera. Es justo el problema que el sistema arregla.
const CERRADAS = ["aprobada", "convertida"];

export async function PUT(request: Request, context: RouteContext<"/api/quotes/[id]/cascada">) {
  try {
    const session = await requireSession(); if (!canWrite(session, "quotes")) throw new Error("FORBIDDEN");
    const { id } = await context.params; if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = cascadaPayload.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });

    await connectDB();
    const before = await Quote.findById(id).lean();
    if (!before) return Response.json({ error: "Cotización no encontrada" }, { status: 404 });
    if (CERRADAS.includes(String(before.status))) {
      return Response.json({ error: `La cotización está ${before.status}: no se puede cambiar el costeo` }, { status: 409 });
    }

    const { items, overheads, cascade } = parsed.data;
    const result = computeCascade({ items, overheads, params: cascade });

    const quote = await Quote.findByIdAndUpdate(id, {
      $set: {
        items, overheads, cascade,
        amountCents: result.priceCents,
        estimatedCostCents: result.directCostCents,
      },
    }, { new: true, runValidators: true }).lean();

    await audit(session, "edit_cascada", "quotes", id, before, quote, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ quote, cascade: result });
  } catch (error) { return apiError(error); }
}
