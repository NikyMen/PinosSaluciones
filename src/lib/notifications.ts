import { Notification } from "./models";
import type { Role } from "./constants";

export type NotificationKind = "obra" | "certificado" | "cotizacion" | "cobranza" | "vencimiento" | "stock" | "general";

export type NotifyInput = {
  title: string;
  body?: string;
  kind?: NotificationKind;
  href?: string;
  /** Roles que la ven en su campanita. Gerencia se agrega siempre. */
  roles: Role[];
  /** Evita duplicados cuando el mismo hecho se dispara dos veces (por ejemplo, al reintentar). */
  dedupeKey?: string;
};

export async function notify({ title, body = "", kind = "general", href, roles, dedupeKey }: NotifyInput) {
  const audience = [...new Set<Role>([...roles, "gerencia"])];
  const payload = { title, body, kind, href, roles: audience, status: "pendiente" as const };
  if (!dedupeKey) return Notification.create(payload);
  // Si ya existe una notificación viva por el mismo hecho, no se duplica.
  return Notification.updateOne({ dedupeKey }, { $setOnInsert: { ...payload, dedupeKey } }, { upsert: true });
}
