import { connectDB } from "@/lib/db";
import { Notification } from "@/lib/models";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { notificationAudience } from "@/lib/notifications";
import { NOTIFICATION_STATUSES, OPEN_NOTIFICATION_STATUSES } from "@/lib/notification-rules";
import { ROLES } from "@/lib/constants";

/**
 * Los avisos de quien mira. Para la campanita, los abiertos (los que están en
 * gestión con recordatorio, recién cuando llega la hora). Para la bandeja
 * (`?bandeja=1`), con filtros: estado, área, "asignados a mí" y, para Gerencia,
 * todos los de la empresa (`?todos=1`).
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    await connectDB();
    const now = new Date();
    const params = new URL(request.url).searchParams;
    const mine = notificationAudience(session);

    if (params.get("bandeja") === "1") {
      const all = params.get("todos") === "1" && session.role === "gerencia";
      const status = params.get("estado") || "";
      const role = params.get("area") || "";
      const filters: Record<string, unknown>[] = all ? [] : [mine];
      if (status === "abiertos") filters.push({ status: { $in: OPEN_NOTIFICATION_STATUSES } });
      else if (status === "vencidos") filters.push({ status: { $in: OPEN_NOTIFICATION_STATUSES }, dueAt: { $lt: now } });
      else if ((NOTIFICATION_STATUSES as readonly string[]).includes(status)) filters.push({ status: status === "nueva" ? { $in: ["nueva", "pendiente"] } : status === "en_gestion" ? { $in: ["en_gestion", "pospuesta"] } : status === "resuelta" ? { $in: ["resuelta", "hecha"] } : status });
      if ((ROLES as readonly string[]).includes(role)) filters.push({ roles: role });
      if (params.get("asignados") === "1") filters.push({ assignedToId: session.userId });
      const items = await Notification.find(filters.length ? { $and: filters } : {}).sort({ createdAt: -1 }).limit(300).lean();
      return Response.json({ items });
    }

    const includeDone = params.get("history") === "1";
    // Activas = las abiertas, salvo las que están en gestión con un recordatorio que todavía no llegó.
    const activeFilter = { $and: [mine, { status: { $in: OPEN_NOTIFICATION_STATUSES } }, { $or: [{ remindAt: { $exists: false } }, { remindAt: null }, { remindAt: { $lte: now } }] }] };
    const [active, history] = await Promise.all([
      Notification.find(activeFilter).sort({ createdAt: -1 }).limit(50).lean(),
      includeDone ? Notification.find(mine).sort({ createdAt: -1 }).limit(100).lean() : Promise.resolve([]),
    ]);
    const unread = active.filter(item => ["nueva", "pendiente"].includes(String(item.status))).length;
    return Response.json({ items: active, unread, history });
  } catch (error) { return apiError(error); }
}
