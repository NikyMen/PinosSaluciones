import { COMPANIES } from "./companies";

/*
 * Lo que se elige al dar de alta una caja o cuenta del maestro de Tesorería. Sin
 * nada de la base: lo usan el modelo, la validación y las pantallas.
 *
 * Cada cuenta tiene un código numérico, como en TANGO, por rangos según la empresa
 * (acordado con Administración el 28/10/2026, ver docs/decisiones):
 *   1–5 cajas Constructora · 6–9 cajas Verticales · 10–19 bancos Constructora ·
 *   20–29 cheques diferidos Constructora · 30–39 bancos Verticales ·
 *   40–49 cheques diferidos Verticales · 50–59 cajas de las dos empresas ·
 *   60–69 otras de Constructora · 70–79 otras de Verticales.
 */

export const CASH_ACCOUNT_TYPES = ["caja", "billetera", "cuenta_corriente", "caja_ahorro", "cuenta_dolares", "valores_cobro", "cheques_diferidos", "tarjeta_credito", "retenciones", "otra"] as const;
export type CashAccountType = (typeof CASH_ACCOUNT_TYPES)[number];

export const cashAccountTypeLabels: Record<CashAccountType, string> = {
  caja: "Caja", billetera: "Billetera virtual", cuenta_corriente: "Cuenta corriente", caja_ahorro: "Caja de ahorro", cuenta_dolares: "Cuenta en dólares",
  valores_cobro: "Valores al cobro (cheques de terceros)", cheques_diferidos: "Cheques diferidos (propios)", tarjeta_credito: "Tarjeta de crédito", retenciones: "Retenciones", otra: "Otra",
};

export const CASH_CURRENCIES = ["ARS", "USD", "BRL", "EUR"] as const;
export const cashCurrencyLabels: Record<(typeof CASH_CURRENCIES)[number], string> = { ARS: "Pesos", USD: "Dólares", BRL: "Reales", EUR: "Euros" };

/** De quién es la cuenta: de una empresa o de las dos (la caja de efectivo, las de moneda extranjera). */
export const CASH_ACCOUNT_COMPANIES = ["tvp", "constructora", "ambas"] as const;
export const SHARED_COMPANY = "ambas";
export const cashAccountCompanyLabels: Record<(typeof CASH_ACCOUNT_COMPANIES)[number], string> = { tvp: COMPANIES.tvp.legalName, constructora: COMPANIES.constructora.legalName, ambas: "Las dos empresas" };

/** "TV Pino", "Constructora Pino" o "Las dos". */
export function cashAccountCompanyShort(company: unknown) {
  return company === SHARED_COMPANY ? "Las dos" : COMPANIES[company as keyof typeof COMPANIES]?.short || COMPANIES.tvp.short;
}

/** Una cuenta sirve para un movimiento de esa empresa si es suya o de las dos. */
export function cashAccountServes(accountCompany: unknown, company: unknown) {
  return accountCompany === SHARED_COMPANY || (accountCompany || "tvp") === (company || "tvp");
}
