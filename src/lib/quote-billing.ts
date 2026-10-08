import { isCreditNote, VOID_INVOICE_STATUSES } from "./invoice-labels";
import { netFromGross } from "./net-amounts";

/*
 * Cuánto se facturó de una cotización y cuánto falta (requerimiento integral
 * v4, punto 4.3). Todo en neto, sin IVA: la cotización vale su neto y cada
 * factura cuenta por el suyo, así una A (con IVA discriminado) y una X (que no
 * lo discrimina) se suman igual. Sin nada de la base: lo usan el servidor y las pantallas.
 *
 * - Cotizado vigente = cotización original + adicionales − reducciones.
 * - Facturado = facturas A, B y X vigentes − notas de crédito + notas de débito.
 * - Pendiente total = vigente − facturado.
 * - Habilitado para facturar = lo que ya se puede facturar (certificados aprobados sin
 *   facturar, remitos pendientes), sin pasar del pendiente.
 */

export type QuoteAdjustment = { kind: "adicional" | "reduccion"; netCents: number; reason?: string; date?: string | Date; userName?: string; _id?: unknown };
export type BillingState = "sin_facturar" | "parcial" | "total" | "exceso";
export type BillingInvoice = { voucherType?: unknown; netCents?: unknown; vatPct?: unknown; amountCents?: unknown; status?: unknown };
export type QuoteBilling = {
  originalCents: number; additionsCents: number; reductionsCents: number;
  /** Cotizado vigente: original + adicionales − reducciones. */
  currentCents: number;
  invoicedCents: number; pendingCents: number;
  /** Lo que ya se puede facturar, sin pasar del pendiente. */
  enabledCents: number;
  /** Facturado sobre vigente, en %. Null si la cotización no tiene importe. */
  invoicedPct: number | null;
  /** Lo facturado de más, si pasa del vigente. */
  excessCents: number;
  state: BillingState;
};

export const billingStateLabels: Record<BillingState, string> = {
  sin_facturar: "Sin facturar", parcial: "Parcialmente facturada", total: "Totalmente facturada", exceso: "Facturada en exceso",
};

/** El neto de una factura con su signo: negativo en una nota de crédito. Una anulada o sustituida no cuenta. */
export function invoiceNetCents(invoice: BillingInvoice) {
  if (VOID_INVOICE_STATUSES.includes(String(invoice.status))) return 0;
  const net = typeof invoice.netCents === "number" && invoice.netCents > 0
    ? invoice.netCents
    // Las de antes, cargadas sólo con el total: la X no discrimina IVA; la A y la B, sí.
    : invoice.voucherType === "factura_x" ? Number(invoice.amountCents || 0) : netFromGross(Number(invoice.amountCents || 0), Number(invoice.vatPct ?? 21));
  return isCreditNote(invoice.voucherType) ? -net : net;
}

/** Lo que se tolera de diferencia por redondeo del IVA entre facturas: un peso, o el 0,1 % del vigente. */
export function billingTolerance(currentCents: number) {
  return Math.max(100, Math.round(Math.abs(currentCents) * 0.001));
}

export function quoteBilling(input: { netCents: number; adjustments?: QuoteAdjustment[]; invoices: BillingInvoice[]; enabledSourcesCents?: number }): QuoteBilling {
  const adjustments = input.adjustments || [];
  const additionsCents = adjustments.filter(item => item.kind === "adicional").reduce((total, item) => total + Number(item.netCents || 0), 0);
  const reductionsCents = adjustments.filter(item => item.kind === "reduccion").reduce((total, item) => total + Number(item.netCents || 0), 0);
  const originalCents = Number(input.netCents || 0);
  const currentCents = originalCents + additionsCents - reductionsCents;
  const invoicedCents = input.invoices.reduce((total, invoice) => total + invoiceNetCents(invoice), 0);
  const tolerance = billingTolerance(currentCents);
  const rawPending = currentCents - invoicedCents;
  const pendingCents = Math.max(0, rawPending);
  const excessCents = rawPending < -tolerance ? -rawPending : 0;
  const enabledCents = Math.max(0, Math.min(pendingCents, Number(input.enabledSourcesCents || 0)));
  const state: BillingState = invoicedCents <= 0 ? "sin_facturar" : excessCents > 0 ? "exceso" : rawPending <= tolerance ? "total" : "parcial";
  return {
    originalCents, additionsCents, reductionsCents, currentCents, invoicedCents,
    pendingCents: state === "total" ? 0 : pendingCents, enabledCents, excessCents, state,
    invoicedPct: currentCents > 0 ? Math.round(invoicedCents / currentCents * 1000) / 10 : null,
  };
}
