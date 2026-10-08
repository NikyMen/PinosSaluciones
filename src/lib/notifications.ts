import { Notification, NotificationSettings, User } from "./models";
import { hoursFor, type NotificationEvent } from "./notification-rules";
import type { Role } from "./constants";

export type NotificationKind = "obra" | "certificado" | "cotizacion" | "cobranza" | "vencimiento" | "stock" | "compra" | "general";

export type NotifyInput = {
  title: string;
  body?: string;
  kind?: NotificationKind;
  href?: string;
  /** Las áreas que lo ven. Gerencia no se agrega sola: recibe las excepciones y lo que se escala. */
  roles: Role[];
  /** Además, personas puntuales (las que pueden autorizar compras, por ejemplo). */
  userIds?: unknown[];
  /** El evento: de ahí sale el plazo para resolverlo antes de escalar a Gerencia (src/lib/notification-rules.ts). */
  event?: NotificationEvent;
  /** Una excepción (una autorización, algo fuera de regla): le llega también a Gerencia. */
  exception?: boolean;
  /** Evita duplicados cuando el mismo hecho se dispara dos veces (por ejemplo, al reintentar). */
  dedupeKey?: string;
};

/** Los plazos por evento que Gerencia cambió desde la bandeja. */
export async function notificationHours(): Promise<Record<string, number>> {
  const settings = await NotificationSettings.findById("default").lean<{ hours?: Record<string, number> }>();
  return settings?.hours ? Object.fromEntries(Object.entries(settings.hours)) : {};
}

export async function notify({ title, body = "", kind = "general", href, roles, userIds, event, exception, dedupeKey }: NotifyInput) {
  const audience = [...new Set<Role>([...roles, ...(exception ? ["gerencia" as const] : [])])];
  const people = userIds?.length ? [...new Set(userIds.map(String))] : undefined;
  // Un aviso sin nadie que lo vea no sirve: queda para Gerencia.
  if (!audience.length && !people) audience.push("gerencia");
  const hours = hoursFor(event, await notificationHours());
  const payload = {
    title, body, kind, href, roles: audience, userIds: people, status: "nueva" as const, event,
    dueAt: hours ? new Date(Date.now() + hours * 3600000) : undefined,
    history: [{ action: "Creada", at: new Date() }],
  };
  if (!dedupeKey) return Notification.create(payload);
  // Si ya existe una notificación viva por el mismo hecho, no se duplica.
  return Notification.updateOne({ dedupeKey }, { $setOnInsert: { ...payload, dedupeKey } }, { upsert: true });
}

/** Quién ve un aviso: los de su rol, los que lo tienen dirigido por nombre y a quien se le asignó. */
export function notificationAudience(session: { role: Role; userId: string }) {
  return { $or: [{ roles: session.role }, { userIds: session.userId }, { assignedToId: session.userId }] };
}

/** Las personas activas con un permiso especial (por ejemplo, autorizar compras), para avisarles por nombre. */
export async function usersWithAction(action: string) {
  const users = await User.find({ active: { $ne: false }, "permissions.actions": action }).select("_id").lean<Array<{ _id: unknown }>>();
  return users.map(user => user._id);
}
