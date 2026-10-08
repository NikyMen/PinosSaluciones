/*
 * La bandeja de avisos y pendientes (requerimiento integral v4, punto 6). Sin
 * nada de la base: lo usan el servidor, el worker y las pantallas.
 *
 * Cada aviso pasa por Nueva → Leída → En gestión → Resuelta (o Descartada, con
 * motivo). Tiene un área (rol) y, si hace falta, una persona asignada, y una
 * fecha límite que sale del tipo de evento. Si vence sin resolverse, el worker
 * lo escala a Gerencia. Gerencia recibe las excepciones y lo escalado, no todos
 * los avisos operativos.
 */

export const NOTIFICATION_STATUSES = ["nueva", "leida", "en_gestion", "resuelta", "descartada"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
/** Los estados de antes: pendiente (= nueva), pospuesta (= en gestión con recordatorio) y hecha (= resuelta). */
export const LEGACY_NOTIFICATION_STATUSES = ["pendiente", "pospuesta", "hecha"] as const;
/** Los que todavía piden algo. */
export const OPEN_NOTIFICATION_STATUSES = ["nueva", "leida", "en_gestion", "pendiente", "pospuesta"];

export const notificationStatusLabels: Record<string, string> = {
  nueva: "Nueva", leida: "Leída", en_gestion: "En gestión", resuelta: "Resuelta", descartada: "Descartada",
  pendiente: "Nueva", pospuesta: "En gestión", hecha: "Resuelta",
};

/**
 * Los eventos que avisan, con a quién y en cuántas horas se tienen que resolver
 * antes de escalar a Gerencia. Las horas se pueden cambiar desde la bandeja
 * (Gerencia); éstas son las de arranque.
 */
export const NOTIFICATION_EVENTS = {
  "cotizacion.aprobada.compras": { label: "Cotización aprobada · Compras: reserva, faltantes y abastecimiento", hours: 48 },
  "cotizacion.aprobada.produccion": { label: "Cotización aprobada · Producción: planificar la obra y la fecha de inicio", hours: 48 },
  "cotizacion.aprobada.administracion": { label: "Cotización aprobada · Administración: anticipo, crédito y condiciones", hours: 48 },
  "compra.autorizar": { label: "Solicitud desde el límite · Gerencia o Presidencia: autorizar o rechazar", hours: 24 },
  "compra.tesoreria": { label: "Solicitud autorizada · Tesorería: factura, vencimiento, OP y pago", hours: 48 },
  "compra.pago": { label: "OP, pago o comprobante · Compras: ver la OC y seguir la recepción", hours: 72 },
  "compra.rechazada": { label: "Solicitud rechazada · Compras", hours: 72 },
  "compra.anulada": { label: "Compra anulada · Compras y Tesorería", hours: 72 },
  "compra.remito_observado": { label: "Remito observado · Compras y Administración", hours: 48 },
  "certificado.cargado": { label: "Certificado cargado · Producción: revisar y gestionar la aprobación del cliente", hours: 72 },
  "certificado.aprobado": { label: "Certificado aprobado · Ventas y Administración: facturar y proyectar la cobranza", hours: 72 },
  "obra.finalizada.ventas": { label: "Obra finalizada · Ventas: facturación y adicionales pendientes", hours: 168 },
  "obra.finalizada.administracion": { label: "Obra finalizada · Administración: cobranza, fondo de reparo y resultado", hours: 168 },
  "obra.finalizada.compras": { label: "Obra finalizada · Compras: cerrar el abastecimiento y recuperar materiales", hours: 168 },
  "obra.finalizada.rrhh": { label: "Obra finalizada · RR. HH.: desafectar al personal y cerrar horas", hours: 168 },
} as const;
export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;

/** Las horas para resolver un evento: las configuradas o las de arranque. Sin plazo, no escala. */
export function hoursFor(event: string | undefined, overrides: Record<string, number> = {}) {
  if (!event) return null;
  const configured = overrides[event];
  if (typeof configured === "number" && configured > 0) return configured;
  return (NOTIFICATION_EVENTS as Record<string, { hours: number }>)[event]?.hours ?? null;
}

export function isOpen(status: unknown) {
  return OPEN_NOTIFICATION_STATUSES.includes(String(status || "nueva"));
}
