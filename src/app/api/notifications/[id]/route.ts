import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Notification, User } from "@/lib/models";
import { requireSession } from "@/lib/auth";
import { apiError, HttpError } from "@/lib/api";
import { notificationAudience } from "@/lib/notifications";
import { isOpen } from "@/lib/notification-rules";

const schema = z.object({
  // "hecha" es la acción de antes: resolver.
  action: z.enum(["leer", "gestionar", "resolver", "descartar", "asignar", "posponer", "reabrir", "hecha"]),
  /** Minutos que se esconde al posponer. Por defecto, mañana a esta hora. */
  minutes: z.coerce.number().int().min(5).max(60 * 24 * 30).optional(),
  reason: z.string().trim().max(500).optional(),
  userId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Lo que se hace con un aviso: leerlo, tomarlo (en gestión), resolverlo,
 * descartarlo con motivo, asignarlo a alguien, posponerlo o reabrirlo. Queda en
 * su historial. Gerencia puede actuar sobre cualquiera.
 */
export async function PATCH(request: Request, context: RouteContext<"/api/notifications/[id]">) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });
    await connectDB();
    const scope = session.role === "gerencia" ? { _id: id } : { _id: id, ...notificationAudience(session) };
    const current = await Notification.findOne(scope).lean<{ status?: string; title?: string }>();
    if (!current) return Response.json({ error: "No encontrada" }, { status: 404 });
    const { action, reason, note } = parsed.data;
    const now = new Date();
    let set: Record<string, unknown> = {};
    let unset: Record<string, ""> = {};
    let label = "";
    if (action === "leer") {
      // Leer sólo cambia una nueva: si ya está en gestión, sigue así.
      if (["nueva", "pendiente"].includes(String(current.status))) { set = { status: "leida" }; label = "Leída"; }
      else return Response.json(await Notification.findById(id).lean());
    } else if (action === "gestionar") { set = { status: "en_gestion", assignedToId: session.userId, assignedToName: session.name }; unset = { remindAt: "" }; label = "En gestión"; }
    else if (action === "resolver" || action === "hecha") { set = { status: "resuelta", doneAt: now, doneByName: session.name }; unset = { remindAt: "" }; label = "Resuelta"; }
    else if (action === "descartar") {
      if (!reason || reason.length < 3) throw new HttpError("Poné por qué se descarta");
      set = { status: "descartada", doneAt: now, doneByName: session.name, discardReason: reason }; unset = { remindAt: "" }; label = "Descartada";
    } else if (action === "asignar") {
      const user = parsed.data.userId ? await User.findOne({ _id: parsed.data.userId, active: { $ne: false } }).select("name").lean<{ name: string }>() : null;
      if (!user) throw new HttpError("Elegí a quién se le asigna");
      set = { assignedToId: parsed.data.userId, assignedToName: user.name, ...(isOpen(current.status) ? { status: "en_gestion" } : {}) }; label = `Asignada a ${user.name}`;
    } else if (action === "posponer") { set = { status: "en_gestion", remindAt: new Date(now.getTime() + (parsed.data.minutes ?? 60 * 24) * 60000) }; label = "Pospuesta"; }
    else if (action === "reabrir") { set = { status: "en_gestion" }; unset = { doneAt: "", doneByName: "", discardReason: "" }; label = "Reabierta"; }
    if (["resolver", "descartar", "hecha"].includes(action) && !isOpen(current.status)) throw new HttpError("Ya está cerrada", 409);
    const item = await Notification.findByIdAndUpdate(id, {
      $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}),
      $push: { history: { action: label, note: reason || note, at: now, userName: session.name } },
    }, { returnDocument: "after" }).lean();
    return Response.json(item);
  } catch (error) { return apiError(error); }
}
