/*
 * Cuánto se facturó de cada remito de venta (requerimiento integral v4, punto
 * 4.2): un remito puede quedar facturado en parte. Cada renglón lleva lo que ya
 * se facturó (`invoicedQty`) y cada factura, qué cantidades de qué renglones
 * factura (`remitoLines`). Sin nada de la base: lo usan el servidor y las pantallas.
 *
 * Los remitos de antes no tienen `invoicedQty`: si estaban facturados, se
 * facturaron enteros.
 */

export type RemitoLineLike = { quantity?: number; unitPriceCents?: number; totalCents?: number; invoicedQty?: number; name?: string; unit?: string };
export type RemitoLike = { status?: unknown; lines?: RemitoLineLike[] };
export type RemitoInvoiceLine = { remitoId: string; line: number; quantity: number };

const round = (value: number) => Math.round(value * 1000) / 1000;

export function invoicedQtyOf(line: RemitoLineLike, remitoStatus: unknown) {
  if (typeof line.invoicedQty === "number") return line.invoicedQty;
  return remitoStatus === "facturado" ? Number(line.quantity || 0) : 0;
}

export function pendingQtyOf(line: RemitoLineLike, remitoStatus: unknown) {
  return Math.max(0, round(Number(line.quantity || 0) - invoicedQtyOf(line, remitoStatus)));
}

/** El neto de una cantidad de un renglón: el total del renglón si es todo, si no cantidad × precio. */
export function lineNetCents(line: RemitoLineLike, quantity: number) {
  if (Math.abs(quantity - Number(line.quantity || 0)) < 1e-9) return Number(line.totalCents ?? Math.round(Number(line.quantity || 0) * Number(line.unitPriceCents || 0)));
  return Math.round(quantity * Number(line.unitPriceCents || 0));
}

/** Lo que falta facturar de un remito, en neto. */
export function remitoPendingCents(remito: RemitoLike) {
  if (remito.status === "anulado") return 0;
  return (remito.lines || []).reduce((total, line) => {
    const pending = pendingQtyOf(line, remito.status);
    if (pending <= 0) return total;
    // Lo pendiente de un renglón empezado es lo que queda del total, para que las partes sumen el total exacto.
    const invoiced = invoicedQtyOf(line, remito.status);
    return total + lineNetCents(line, Number(line.quantity || 0)) - (invoiced > 0 ? lineNetCents(line, invoiced) : 0);
  }, 0);
}

/** El estado según lo facturado de cada renglón. */
export function remitoBillingStatus(lines: RemitoLineLike[]) {
  const invoiced = lines.map(line => Number(line.invoicedQty || 0));
  if (lines.length && lines.every((line, index) => invoiced[index] >= Number(line.quantity || 0) - 1e-9)) return "facturado";
  return invoiced.some(quantity => quantity > 0) ? "parcial" : "pendiente";
}

/** El neto de lo que factura una factura de sus remitos. */
export function invoiceLinesNetCents(remitos: Array<RemitoLike & { _id: unknown }>, lines: RemitoInvoiceLine[]) {
  return lines.reduce((total, entry) => {
    const remito = remitos.find(candidate => String(candidate._id) === entry.remitoId);
    const line = remito?.lines?.[entry.line];
    if (!line) return total;
    const invoiced = invoicedQtyOf(line, remito.status);
    // Si con esto se completa el renglón, va lo que queda del total (sin perder centavos por redondeo).
    if (Math.abs(invoiced + entry.quantity - Number(line.quantity || 0)) < 1e-9) return total + lineNetCents(line, Number(line.quantity || 0)) - (invoiced > 0 ? lineNetCents(line, invoiced) : 0);
    return total + lineNetCents(line, entry.quantity);
  }, 0);
}
