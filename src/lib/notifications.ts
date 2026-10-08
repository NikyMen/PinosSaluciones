import { Notification, User } from "./models";
import type { Role } from "./constants";

export type NotificationKind = "obra" | "certificado" | "cotizacion" | "cobranza" | "vencimiento" | "stock" | "compra" | "general";

export type NotifyInput = {
  title: string;
  body?: string;
  kind?: NotificationKind;
  href?: string;
  /** Roles que la ven en su campanita. Gerencia se agrega siempre. */
  roles: Role[];
  /** Además, personas puntuales (las que pueden autorizar compras, por ejemplo). */
  userIds?: unknown[];
  /** Evita duplicados cuando el mismo hecho se dispara dos veces (por ejemplo, al reintentar). */
  dedupeKey?: string;
};

export async function notify({ title, body = "", kind = "general", href, roles, userIds, dedupeKey }: NotifyInput) {
  const audience = [...new Set<Role>([...roles, "gerencia"])];
  const people = userIds?.length ? [...new Set(userIds.map(String))] : undefined;
  const payload = { title, body, kind, href, roles: audience, userIds: people, status: "pendiente" as const };
  if (!dedupeKey) return Notification.create(payload);
  // Si ya existe una notificación viva por el mismo hecho, no se duplica.
  return Notification.updateOne({ dedupeKey }, { $setOnInsert: { ...payload, dedupeKey } }, { upsert: true });
}

/** Quién ve un aviso: los de su rol y los que lo tienen dirigido a su nombre. */
export function notificationAudience(session: { role: Role; userId: string }) {
  return { $or: [{ roles: session.role }, { userIds: session.userId }] };
}

/** Las personas activas con un permiso especial (por ejemplo, autorizar compras), para avisarles por nombre. */
export async function usersWithAction(action: string) {
  const users = await User.find({ active: { $ne: false }, "permissions.actions": action }).select("_id").lean<Array<{ _id: unknown }>>();
  return users.map(user => user._id);
}
