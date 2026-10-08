import { computeCascade, type CascadeParams, type OverheadLine, type QuoteItem } from "./cascada";

/*
 * El neto (sin IVA) de una cotización y de una obra.
 *
 * El precio de la cotización (`amountCents`) es lo que paga el cliente, con IVA.
 * Pero lo que se certifica y lo que se controla al facturar es el neto: la
 * factura le suma el IVA una sola vez. Antes el certificado era un % del precio
 * con IVA y la factura le volvía a sumar el 21 %.
 */

export const DEFAULT_VAT_PCT = 21;

/** El neto de un importe con IVA incluido. */
export function netFromGross(grossCents: number, vatPct = DEFAULT_VAT_PCT) {
  return Math.round(Number(grossCents || 0) / (1 + (Number(vatPct) || 0) / 100));
}

type QuoteLike = { netCents?: number | null; amountCents?: number; items?: QuoteItem[]; overheads?: OverheadLine[]; cascade?: Partial<CascadeParams> | null };

/**
 * El neto de una cotización: el guardado o, en una vieja que no lo tiene, el
 * subtotal 3 de su cascada; si se cargó a mano, el precio sin el IVA.
 */
export function quoteNetCents(quote: QuoteLike) {
  if (typeof quote.netCents === "number") return quote.netCents;
  if (quote.items?.length) return computeCascade({ items: quote.items, overheads: quote.overheads, params: quote.cascade || undefined }).subtotal3Cents;
  return netFromGross(Number(quote.amountCents || 0), quote.cascade?.ivaPct ?? DEFAULT_VAT_PCT);
}

/** El presupuesto neto de una obra: el guardado o, en una vieja, su presupuesto sin el IVA. */
export function workNetBudgetCents(work: { budgetNetCents?: number | null; budgetCents?: number }) {
  return typeof work.budgetNetCents === "number" ? work.budgetNetCents : netFromGross(Number(work.budgetCents || 0));
}
