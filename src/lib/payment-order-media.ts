/*
 * Lo que tiene que tener cada medio de una orden de pago para pagarla
 * (Administración, noviembre 2026): todo lo que el medio muestra es
 * obligatorio. La caja o cuenta y el importe siempre; el cheque y el e-Cheq,
 * su número, su banco, su fecha de cobro y el comprobante; la transferencia,
 * la tarjeta y "otro", su número (la referencia) y el comprobante. El efectivo
 * no pide comprobante: su constancia es la firma de quien recibe en el PDF de
 * la OP. Sin nada de la base: lo usan la pantalla y la API.
 */

/** Los medios que llevan su número en la referencia (el cheque lo lleva en el cheque). */
export const MEDIA_NEEDING_NUMBER = new Set(["transferencia", "tarjeta", "otro"]);
/** Los medios que llevan el comprobante adjunto. */
export const MEDIA_NEEDING_RECEIPT = new Set(["transferencia", "cheque", "echeq", "tarjeta", "otro"]);
const OWN_CHECKS = new Set(["cheque", "echeq"]);

/** El medio con su artículo, para los mensajes. */
const named: Record<string, string> = {
  transferencia: "la transferencia", efectivo: "el efectivo", cheque: "el cheque", echeq: "el e-Cheq",
  cheque_tercero: "el cheque de terceros", tarjeta: "el pago con tarjeta", otro: "el pago",
};

export type MediumToCheck = {
  method: string; amountCents: number; hasAccount: boolean; reference?: string;
  check?: { number?: string; bank?: string; dueDate?: string } | null; checkId?: string | null; hasAttachment: boolean;
};

/**
 * Lo que le falta a un medio para pagar la OP, o nada. `multiple`: la OP tiene
 * varios medios y cada uno lleva su importe (con uno solo, el importe es el total).
 */
export function paymentMediumProblem(medium: MediumToCheck, multiple: boolean) {
  const what = named[medium.method] || "el medio de pago";
  // "de el cheque" es "del cheque".
  const of = what.startsWith("el ") ? `del ${what.slice(3)}` : `de ${what}`;
  if (medium.method === "cheque_tercero") return medium.checkId ? "" : "Elegí el cheque de terceros de la cartera";
  if (multiple && !(medium.amountCents > 0)) return `Poné el importe ${of}`;
  if (!medium.hasAccount) return OWN_CHECKS.has(medium.method) ? `Elegí la cuenta de cheques diferidos ${of}` : `Elegí de qué caja o cuenta sale ${what}`;
  if (OWN_CHECKS.has(medium.method)) {
    if (!medium.check?.number?.trim()) return `Poné el N° ${of}`;
    if (!medium.check.bank?.trim()) return `Poné el banco ${of}`;
    if (!medium.check.dueDate) return `Poné la fecha de cobro ${of}`;
  }
  if (MEDIA_NEEDING_NUMBER.has(medium.method) && !medium.reference?.trim()) return medium.method === "transferencia" ? "Poné el N° de la transferencia" : `Poné el número o la referencia ${of}`;
  if (MEDIA_NEEDING_RECEIPT.has(medium.method) && !medium.hasAttachment) return `Adjuntá el comprobante ${of}`;
  return "";
}
