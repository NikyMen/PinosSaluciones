/*
 * Lo fiscal de ARCA que usan también las pantallas y los PDF (sin nada del
 * servidor): la condición frente al IVA, los códigos de comprobante y el QR.
 * La conexión con ARCA está en src/lib/arca.ts.
 */

/** La condición frente al IVA del cliente, con el código que pide ARCA (RG 5616). */
export const VAT_CONDITIONS = {
  responsable_inscripto: { id: 1, label: "IVA Responsable Inscripto" },
  monotributo: { id: 6, label: "Responsable Monotributo" },
  exento: { id: 4, label: "IVA Sujeto Exento" },
  consumidor_final: { id: 5, label: "Consumidor Final" },
  no_alcanzado: { id: 15, label: "IVA No Alcanzado" },
} as const;
export type VatCondition = keyof typeof VAT_CONDITIONS;
export const VAT_CONDITION_KEYS = Object.keys(VAT_CONDITIONS) as VatCondition[];

/** Sin la condición cargada en el cliente: la A va a un responsable inscripto y la B a un consumidor final. */
export function vatConditionFor(voucherType: unknown, condition: unknown): VatCondition {
  if (typeof condition === "string" && condition in VAT_CONDITIONS) return condition as VatCondition;
  return String(voucherType || "").endsWith("_b") ? "consumidor_final" : "responsable_inscripto";
}

/** Los códigos de ARCA de cada comprobante de venta. */
export const ARCA_VOUCHER_CODE = { factura_a: 1, nota_debito_a: 2, nota_credito_a: 3, factura_b: 6, nota_debito_b: 7, nota_credito_b: 8 } as const;
export type ArcaVoucherType = keyof typeof ARCA_VOUCHER_CODE;

/** El link del QR que va en la factura impresa (especificación de ARCA, RG 4892). */
export function arcaQrUrl(data: { issueDate: string; companyCuit: string; pointOfSale: number; voucherCode: number; number: number; amountCents: number; clientCuit: string; cae: string }) {
  const payload = {
    ver: 1, fecha: data.issueDate.slice(0, 10), cuit: Number(data.companyCuit.replace(/\D/g, "")),
    ptoVta: data.pointOfSale, tipoCmp: data.voucherCode, nroCmp: data.number, importe: Math.round(data.amountCents) / 100,
    moneda: "PES", ctz: 1, tipoDocRec: 80, nroDocRec: Number(data.clientCuit.replace(/\D/g, "")), tipoCodAut: "E", codAut: Number(data.cae),
  };
  return `https://www.afip.gob.ar/fe/qr/?p=${btoa(JSON.stringify(payload))}`;
}
