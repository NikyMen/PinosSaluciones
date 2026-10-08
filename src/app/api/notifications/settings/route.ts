import { z } from "zod";
import { connectDB } from "@/lib/db";
import { NotificationSettings } from "@/lib/models";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notificationHours } from "@/lib/notifications";
import { NOTIFICATION_EVENTS } from "@/lib/notification-rules";

/** Los plazos de la bandeja por evento, en horas: los de arranque y los que cambió Gerencia. */
export async function GET() {
  try {
    await requireSession();
    await connectDB();
    const hours = await notificationHours();
    return Response.json({ items: Object.entries(NOTIFICATION_EVENTS).map(([event, rule]) => ({ event, label: rule.label, defaultHours: rule.hours, hours: hours[event] ?? rule.hours })) });
  } catch (error) { return apiError(error); }
}

const schema = z.object({ hours: z.record(z.string(), z.coerce.number().int().min(1).max(24 * 90)) });

/** Gerencia cambia en cuántas horas se escala a ella cada tipo de aviso sin resolver. */
export async function PUT(request: Request) {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Poné horas entre 1 y 2160" }, { status: 400 });
    const valid = Object.fromEntries(Object.entries(parsed.data.hours).filter(([event]) => event in NOTIFICATION_EVENTS));
    await connectDB();
    const before = await notificationHours();
    await NotificationSettings.updateOne({ _id: "default" }, { $set: { hours: valid } }, { upsert: true });
    await audit(session, "update", "notification_settings", "default", before, valid);
    return Response.json({ hours: valid });
  } catch (error) { return apiError(error); }
}
