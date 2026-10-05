/*
 * El plan de cuentas de caja (Anexo A de la especificación, archivo "Cuenta
 * Cajas.xlsx"). Todo ingreso y todo egreso de plata se imputa a una de estas
 * cuentas: no se escribe una cuenta libre. Los nombres van tal cual figuran en
 * el archivo de administración. Sin nada de la base: lo usan también las pantallas.
 */

export const ACCOUNT_CODES = ["BB", "CC", "CE", "CI", "GGD", "GGI", "IMP", "OP"] as const;
export type AccountCode = (typeof ACCOUNT_CODES)[number];

export const accountCodeLabels: Record<AccountCode, string> = {
  BB: "Beneficios",
  CC: "Costo-Costo",
  CE: "Cuenta Egreso",
  CI: "Cuenta Ingreso",
  GGD: "Gastos Generales Directos",
  GGI: "Gastos Generales Indirectos",
  IMP: "Impuestos",
  OP: "Otros Pagos",
};

/** CI es lo único que es ingreso; el resto de los códigos son egresos. */
export function accountDirection(code: unknown): "ingreso" | "egreso" {
  return code === "CI" ? "ingreso" : "egreso";
}

/** Las dos cuentas que deja un movimiento entre cuentas propias: sale de una, entra en la otra. */
export const TRANSFER_OUT_ACCOUNT = "CE - Movimiento Entre Cuentas";
export const TRANSFER_IN_ACCOUNT = "CI - MOVIMIENTO ENTRE CUENTAS";

const names: Record<AccountCode, string[]> = {
  BB: ["Compras de Bienes de Uso", "Retiros de los dueños"],
  CC: ["Alquiler de equipos", "Contratos de terceros operativos", "Costos de blanqueo", "Materiales", "Sueldos de personal operativo"],
  CE: ["Acreditación de cheques", "Acreedores -de terceros-", "Movimiento Entre Cuentas"],
  CI: ["ACREDITACION DE CHEQUES", "ACREEDORES DE TERCEROS", "ANTICIPOS", "APORTE DE SOCIOS", "CERTIFICADOS", "CUOTA", "MOVIMIENTO ENTRE CUENTAS", "Préstamos -de entidades financieras-", "VENTA DE MATERIALES"],
  GGD: [
    "Alojamiento de chóferes", "Alojamiento para Dirección de Obra", "Alojamiento para Pañolero", "Alojamiento para personal operativo",
    "Combustible para movilidad de Dirección de Obra", "Combustible para movilidad de personal operativo", "Elementos de señalización",
    "Fletes de materiales", "Fondo de Reparo", "Garantías para la Ejecución", "Garantías para la Oferta", "Gastos de movilidad de Pañolero",
    "Gastos varios de movilidad -Estacionamiento, peajes, etc-", "Impresiones y Librería para presentación de ofertas", "Impuesto al cheque",
    "Indumentaria y EPP para Dirección de Obra", "Indumentaria y EPP para el personal operativo", "Librería", "Mantenimiento de Bienes de Uso",
    "Mantenimiento vehicular de Dirección de Obra", "Mantenimiento vehicular para personal de compras", "Mantenimiento vehicular para personal operativo",
    "Pasajes para Dirección de Obra", "Pasajes para personal de compras", "Pasajes para personal operativo", "Programa de Higiene y Seguridad",
    "Representación Técnica", "Seguros para Dirección de Obra", "Seguros para el personal operativo", "Sellados", "Sueldo / Honorarios de Pañolero",
    "Sueldos / Honorarios de Dirección de Obra", "Sueldos / Honorarios de Resposable de Higiene y Seguridad", "Viáticos de chóferes",
    "Viáticos de Dirección de Obra", "Viáticos de Pañolero", "Viáticos del personal operativo",
  ],
  GGI: [
    "Alquileres", "Combustibles", "Comisiones bancarias", "Contratos con Asesores", "Costos administrativos", "Costos de Tarjeta de Crédito",
    "Gastos varios de movilidad -Estacionamiento, peajes, etc-", "Librería", "Mantenimiento de vehiculos", "Mantenimiento y limpieza de edificios",
    "Publicidad y Marketing", "Seguro de vehículos", "Seguro de vehículos de producción", "Seguros para edificios", "Seguros personales",
    "Servicio de seguridad de edificios", "Servicios e impuestos municipales", "Servicios postales", "Sueldos y honorarios", "Teléfono",
  ],
  IMP: ["Impuestos nacionales", "Impuestos provinciales"],
  OP: ["Intereses de préstamos", "Prestamos de entidades de crédito"],
};

/** El catálogo inicial: "CI - CERTIFICADOS", "GGI - Alquileres"… */
export const ACCOUNT_CATALOG = ACCOUNT_CODES.flatMap(code => names[code].map(name => ({ code, name: `${code} - ${name}`, direction: accountDirection(code) })));

/** Las cuentas que se ofrecen por defecto según de dónde sale el movimiento. */
export const DEFAULT_ACCOUNTS = {
  /** Un recibo de una factura de obra o certificado. */
  collection: "CI - CERTIFICADOS",
  /** Un recibo de una venta de materiales del salón. */
  materialSale: "CI - VENTA DE MATERIALES",
  /** Un pago de una factura de materiales. */
  materialPayment: "CC - Materiales",
} as const;
