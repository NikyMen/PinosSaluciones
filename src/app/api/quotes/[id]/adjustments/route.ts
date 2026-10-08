import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canDelete, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Quote } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { money } from "@/lib/format";

/*
 * Adicionales y reducciones de una cotización (requerimiento integral v4, 4.3):
 * cambian lo cotizado vigente sin tocar la cotización original, que es lo que el
 * cliente aprobó. Se cargan en neto y quedan en el historial.
 */

const schema = z.object({
  kind: z.enum(["adicional", "reduccion"]),
  netCents: z.coerce.number().int().positive("Poné el importe neto"),
  reason: z.string().trim().min(3, "Poné el motivo").max(500),
  date: z.coerce.date().optional(),
});

const kindLabel = { adicional: "Adicional", reduccion: "Reducción" } as const;

export async function POST(request: Request, context: RouteContext<"/api/quotes/[id]/adjustments">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "quotes")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const before = await Quote.findById(id).select("number adjustments").lean();
    if (!before) return Response.json({ error: "Cotización no encontrada" }, { status: 404 });
    const adjustment = { ...parsed.data, date: parsed.data.date ?? new Date(), userId: session.userId, userName: session.name };
    const quote = await Quote.findByIdAndUpdate(id, {
      $push: { adjustments: adjustment, history: { action: `${kindLabel[parsed.data.kind]} de ${money(parsed.data.netCents)} neto`, note: parsed.data.reason, at: new Date(), userId: session.userId, userName: session.name } },
    }, { returnDocument: "after" }).select("number adjustments").lean();
    await audit(session, "add_adjustment", "quotes", id, before, quote, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(quote, { status: 201 });
  } catch (error) { return apiError(error); }
}

/** Sacar un adicional o una reducción cargada por error: sólo Gerencia, y queda en el historial. */
export async function DELETE(request: Request, context: RouteContext<"/api/quotes/[id]/adjustments">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "quotes") || !canDelete(session)) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const adjustmentId = new URL(request.url).searchParams.get("id") || "";
    if (!isValidObjectId(id) || !isValidObjectId(adjustmentId)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const before = await Quote.findOne({ _id: id, "adjustments._id": adjustmentId }).select("number adjustments").lean<{ adjustments: Array<{ _id: unknown; kind: "adicional" | "reduccion"; netCents: number; reason: string }> }>();
    const removed = before?.adjustments.find(item => String(item._id) === adjustmentId);
    if (!before || !removed) return Response.json({ error: "No encontrado" }, { status: 404 });
    const quote = await Quote.findByIdAndUpdate(id, {
      $pull: { adjustments: { _id: adjustmentId } },
      $push: { history: { action: `Se sacó un ${kindLabel[removed.kind].toLowerCase()} de ${money(removed.netCents)} neto`, note: removed.reason, at: new Date(), userId: session.userId, userName: session.name } },
    }, { returnDocument: "after" }).select("number adjustments").lean();
    await audit(session, "remove_adjustment", "quotes", id, before, quote, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(quote);
  } catch (error) { return apiError(error); }
}
