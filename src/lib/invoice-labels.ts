/*
 * Cómo se nombra cada comprobante. Sin nada de la base: lo usan también las pantallas.
 *
 * Ventas: Factura A y B son fiscales (pasan por ARCA); el comprobante interno X
 * no. Compras: Factura A y C fiscales recibidas y el registro interno X. La X
 * cuenta para la gestión (cuentas corrientes, caja, costos, rentabilidad) pero
 * queda fuera de los reportes fiscales, como el libro IVA.
 */

export const VOUCHER_TYPES = ["factura_a", "factura_b", "factura_c", "factura_x"] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];
export const SALES_VOUCHER_TYPES = ["factura_a", "factura_b", "factura_x"] as const;
export const PURCHASE_VOUCHER_TYPES = ["factura_a", "factura_c", "factura_x"] as const;

export const voucherLabels: Record<string, string> = { factura_a: "Factura A", factura_b: "Factura B", factura_c: "Factura C", factura_x: "Factura X" };

/** La X no pasa por ARCA: no va al libro IVA ni a ningún reporte fiscal. */
export function isFiscalVoucher(voucherType: unknown) {
  return voucherType !== "factura_x";
}

export const INVOICE_STATUSES = ["pendiente", "parcial", "cobrada", "anulada", "sustituida"] as const;
/** Una factura anulada, o una X que se reemplazó por la fiscal, ya no cuenta en ningún número. */
export const VOID_INVOICE_STATUSES = ["anulada", "sustituida"];

/** "0001-00000123": el número de un talonario interno con su punto de venta. */
export function formatVoucherNumber(pointOfSale: string, sequence: number) {
  return `${String(pointOfSale || "1").replace(/\D/g, "").padStart(4, "0").slice(-4)}-${String(sequence).padStart(8, "0")}`;
}

/** "Factura A 0001-00000123", o solo el número en una factura vieja sin tipo. */
export function invoiceLabel(invoice: { voucherType?: unknown; number?: unknown; [key: string]: unknown }) {
  const type = voucherLabels[String(invoice.voucherType || "")];
  // Las X se guardan como "X-0001-00000001" para no chocar con el número de una fiscal del mismo cliente.
  const number = String(invoice.number || "").replace(/^X-/, "");
  return [type, number].filter(Boolean).join(" ");
}
