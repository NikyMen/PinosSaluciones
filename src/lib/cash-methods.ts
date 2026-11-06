import type { CashAccountType } from "./cash-account-kinds";

/*
 * Los medios con que se cobra y se paga (anexo de Tesorería v5.1, validado con
 * Administración). Sin nada de la base: lo usan el modelo, los servicios y las
 * pantallas.
 *
 * - El cheque y el e-Cheq propios son siempre diferidos: salen de la cuenta de
 *   cheques diferidos de su banco hasta que el banco los debita.
 * - El cheque de terceros entra por un recibo a Valores al Cobro y de ahí se
 *   endosa en una OP o se deposita.
 * - La tarjeta: en la OP, la corporativa; en el recibo, el posnet. Las dos van a
 *   la cuenta de tarjeta de la empresa (así la usa Administración).
 */

export const PAYMENT_METHODS = ["transferencia", "efectivo", "cheque", "echeq", "cheque_tercero", "tarjeta", "otro"] as const;
export const COLLECTION_METHODS = ["transferencia", "efectivo", "cheque", "echeq", "tarjeta", "otro"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type CollectionMethod = (typeof COLLECTION_METHODS)[number];

export const cashMethodLabels: Record<string, string> = {
  transferencia: "Transferencia", efectivo: "Efectivo", cheque: "Cheque", echeq: "e-Cheq",
  cheque_tercero: "Cheque de terceros", tarjeta: "Tarjeta", retencion: "Retención", otro: "Otro",
};

/** Lo que pide el comprobante adjunto al pagar (Administración: cheque y transferencia, sí o sí). */
export const METHODS_NEEDING_ATTACHMENT = new Set(["transferencia", "cheque", "echeq"]);

/** Los medios que son un cheque propio, que se le entrega al proveedor. */
export const OWN_CHECK_METHODS = new Set(["cheque", "echeq"]);

const BANKS: CashAccountType[] = ["cuenta_corriente", "caja_ahorro", "cuenta_dolares", "billetera"];

/**
 * Qué cuentas del maestro sirve cada medio, al pagar y al cobrar. "Otra" (las que
 * se armaron con los nombres de antes) sirve para todo menos los cheques, que
 * tienen su circuito.
 */
export function accountTypesFor(method: string, side: "pago" | "cobro"): CashAccountType[] | null {
  if (method === "efectivo") return ["caja", "otra"];
  if (method === "transferencia") return [...BANKS, "otra"];
  if (method === "tarjeta") return ["tarjeta_credito", "otra"];
  if (method === "cheque_tercero") return ["valores_cobro"];
  if (method === "cheque" || method === "echeq") return side === "pago" ? ["cheques_diferidos"] : ["valores_cobro"];
  return null;
}

export const RETENTION_TYPES = ["ganancias", "iibb", "iva", "suss", "otros"] as const;
export const retentionLabels: Record<(typeof RETENTION_TYPES)[number], string> = { ganancias: "Ganancias", iibb: "Ingresos Brutos", iva: "IVA", suss: "SUSS", otros: "Otros impuestos" };
