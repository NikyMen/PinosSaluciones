/* Cómo se leen los estados de las compras. Sin nada de la base: lo usan también las pantallas. */

export const requestStatusLabels: Record<string, string> = {
  borrador: "Borrador", pendiente_autorizacion: "Pendiente de autorización", autorizada: "Autorizada", rechazada: "Rechazada", anulada: "Anulada",
  // Los de antes de la migración.
  aprobada: "Aprobada", enviada: "Enviada", recibida: "Recibida", cancelada: "Cancelada",
};
export const orderStatusLabels: Record<string, string> = { emitida: "Emitida", cerrada: "Cerrada", anulada: "Anulada", aprobada: "Aprobada", enviada: "Enviada", recibida: "Recibida", cancelada: "Cancelada" };
export const paymentTermLabels: Record<string, string> = { contado: "Contado", cuenta_corriente: "Cuenta corriente", plazo: "A plazo" };
/** De contado: cómo se paga. */
export const cashMethodLabels: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia" };

/** La condición de compra en una línea: "Contado en efectivo", "A plazo a 30 días", "Cuenta corriente". */
export function purchaseTermsText(purchase: Record<string, unknown>) {
  const terms = String(purchase.paymentTerms || "contado");
  if (terms === "plazo") return `A plazo${purchase.termDays ? ` a ${String(purchase.termDays)} días` : ""}`;
  if (terms === "contado") return purchase.cashMethod === "efectivo" ? "Contado en efectivo" : purchase.cashMethod === "transferencia" ? "Contado por transferencia" : "Contado";
  return paymentTermLabels[terms] || terms;
}
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
