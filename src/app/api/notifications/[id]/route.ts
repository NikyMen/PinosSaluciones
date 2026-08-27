import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Notification } from "@/lib/models";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";

const schema = z.object({
  action: z.enum(["hecha", "posponer"]),
  /** Minutos que se esconde al posponer. Por defecto, mañana a esta hora. */
  minutes: z.coerce.number().int().min(5).max(60 * 24 * 30).optional(),
});

export async function PATCH(request: Request, context: RouteContext<"/api/notifications/[id]">) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });

    await connectDB();
    const update = parsed.data.action === "hecha"
      // "Hecho" no la borra: sale de la campanita pero queda en el historial.
      ? { status: "hecha", doneAt: new Date(), doneByName: session.name }
      : { status: "pospuesta", remindAt: new Date(Date.now() + (parsed.data.minutes ?? 60 * 24) * 60000) };

    const item = await Notification.findOneAndUpdate({ _id: id, roles: session.role }, { $set: update }, { new: true }).lean();
    return item ? Response.json(item) : Response.json({ error: "No encontrada" }, { status: 404 });
  } catch (error) { return apiError(error); }
}
