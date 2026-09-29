/* Cómo se nombra cada comprobante. Sin nada de la base: lo usan también las pantallas. */

export const VOUCHER_TYPES = ["factura_a", "factura_b", "factura_c"] as const;
export const voucherLabels: Record<string, string> = { factura_a: "Factura A", factura_b: "Factura B", factura_c: "Factura C" };

/** "Factura A 0001-00000123", o solo el número en una factura vieja sin tipo. */
export function invoiceLabel(invoice: { voucherType?: unknown; number?: unknown; [key: string]: unknown }) {
  const type = voucherLabels[String(invoice.voucherType || "")];
  return [type, String(invoice.number || "")].filter(Boolean).join(" ");
}
