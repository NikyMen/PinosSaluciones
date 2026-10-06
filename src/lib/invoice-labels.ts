/*
 * Cómo se nombra cada comprobante. Sin nada de la base: lo usan también las pantallas.
 *
 * Ventas: Factura A y B son fiscales (pasan por ARCA); el comprobante interno X
 * no. Compras: Factura A y C fiscales recibidas y el registro interno X. La X
 * cuenta para la gestión (cuentas corrientes, caja, costos, rentabilidad) pero
 * queda fuera de los reportes fiscales, como el libro IVA.
 */

export const VOUCHER_TYPES = ["factura_a", "nota_debito_a", "nota_credito_a", "factura_b", "nota_debito_b", "nota_credito_b", "factura_c", "factura_x"] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];
/** Ventas, en el orden en que se eligen: A con sus notas, B con sus notas y la X interna. */
export const SALES_VOUCHER_TYPES = ["factura_a", "nota_debito_a", "nota_credito_a", "factura_b", "nota_debito_b", "nota_credito_b", "factura_x"] as const;
export type SalesVoucherType = (typeof SALES_VOUCHER_TYPES)[number];
export const PURCHASE_VOUCHER_TYPES = ["factura_a", "factura_c", "factura_x"] as const;
/** Los talonarios son de facturas: las notas de débito y crédito usan el de la factura de su letra. */
export const BOOK_VOUCHER_TYPES = ["factura_a", "factura_b", "factura_c", "factura_x"] as const;

export const voucherLabels: Record<string, string> = {
  factura_a: "Factura A", nota_debito_a: "Nota de Débito A", nota_credito_a: "Nota de Crédito A",
  factura_b: "Factura B", nota_debito_b: "Nota de Débito B", nota_credito_b: "Nota de Crédito B",
  factura_c: "Factura C", factura_x: "Factura X",
};

export const CREDIT_NOTE_TYPES = ["nota_credito_a", "nota_credito_b"];
export const NOTE_TYPES = ["nota_debito_a", "nota_credito_a", "nota_debito_b", "nota_credito_b"];

/** La nota de crédito resta: baja la venta, el IVA y lo que el cliente debe. */
export function isCreditNote(voucherType: unknown) {
  return CREDIT_NOTE_TYPES.includes(String(voucherType));
}

/** Una nota de débito o de crédito: va siempre asociada a una factura de su misma letra. */
export function isNote(voucherType: unknown) {
  return NOTE_TYPES.includes(String(voucherType));
}

/** La factura de la letra del comprobante: el talonario y el punto de venta de una nota son los de su factura. */
export function baseInvoiceType(voucherType: unknown): VoucherType {
  const letter = String(voucherType || "").slice(-1);
  return letter === "b" ? "factura_b" : letter === "c" ? "factura_c" : letter === "x" ? "factura_x" : "factura_a";
}

/** El importe con su signo: negativo en una nota de crédito. */
export function signedAmount(invoice: Record<string, unknown>) {
  const amount = Number(invoice.amountCents || 0);
  return isCreditNote(invoice.voucherType) ? -amount : amount;
}

/** Lo mismo en una agregación de Mongo. */
export const SIGNED_AMOUNT = { $cond: [{ $in: ["$voucherType", CREDIT_NOTE_TYPES] }, { $multiply: ["$amountCents", -1] }, "$amountCents"] };

/** La X no pasa por ARCA: no va al libro IVA ni a ningún reporte fiscal. */
export function isFiscalVoucher(voucherType: unknown) {
  return voucherType !== "factura_x";
}

// "aplicada": una nota de crédito, que no se cobra: descuenta de la factura a la que está asociada.
export const INVOICE_STATUSES = ["pendiente", "parcial", "cobrada", "aplicada", "anulada", "sustituida"] as const;
/** Una factura anulada, o una X que se reemplazó por la fiscal, ya no cuenta en ningún número. */
export const VOID_INVOICE_STATUSES = ["anulada", "sustituida"];

/** "0001-00000123": el número de un talonario interno con su punto de venta. */
export function formatVoucherNumber(pointOfSale: string, sequence: number) {
  return `${String(pointOfSale || "1").replace(/\D/g, "").padStart(4, "0").slice(-4)}-${String(sequence).padStart(8, "0")}`;
}

/** "Factura A 0001-00000123" (o "Nota de Crédito A ..."), o solo el número en una factura vieja sin tipo. */
export function invoiceLabel(invoice: { voucherType?: unknown; number?: unknown; [key: string]: unknown }) {
  const type = voucherLabels[String(invoice.voucherType || "")];
  // Las X se guardan como "X-0001-00000001" para no chocar con el número de una fiscal del mismo cliente.
  const number = String(invoice.number || "").replace(/^X-/, "");
  return [type, number].filter(Boolean).join(" ");
}
