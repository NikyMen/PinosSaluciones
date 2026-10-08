/* Cómo se leen los estados de las compras. Sin nada de la base: lo usan también las pantallas. */

export const requestStatusLabels: Record<string, string> = {
  borrador: "Borrador", pendiente_autorizacion: "Pendiente de autorización", autorizada: "Autorizada", rechazada: "Rechazada", anulada: "Anulada",
  // Los de antes de la migración.
  aprobada: "Aprobada", enviada: "Enviada", recibida: "Recibida", cancelada: "Cancelada",
};
export const orderStatusLabels: Record<string, string> = { emitida: "Emitida", cerrada: "Cerrada", anulada: "Anulada", aprobada: "Aprobada", enviada: "Enviada", recibida: "Recibida", cancelada: "Cancelada" };
export const paymentTermLabels: Record<string, string> = { contado: "Contado", cuenta_corriente: "Cuenta corriente", plazo: "A plazo" };
export const orderPaymentLabels: Record<string, string> = { pendiente: "Sin pagar", parcial: "Pagada en parte", pagada: "Pagada" };
export const orderReceptionLabels: Record<string, string> = { pendiente: "Sin recibir", parcial: "Recibida en parte", recibida: "Recibida" };

/** El estado de una compra en una línea: el de la solicitud, o el de la orden con su pago y su recepción. */
export function purchaseStatusText(purchase: Record<string, unknown>) {
  const status = String(purchase.status || "");
  if (purchase.stage === "solicitud") return requestStatusLabels[status] || status;
  if (status === "anulada" || status === "cancelada") return orderStatusLabels[status];
  const base = orderStatusLabels[status] || status;
  return [base, orderPaymentLabels[String(purchase.paymentStatus || "pendiente")], status === "cerrada" ? "" : orderReceptionLabels[String(purchase.receptionStatus || "pendiente")]].filter(Boolean).join(" · ");
}
