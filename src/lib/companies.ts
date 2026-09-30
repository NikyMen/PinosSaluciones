/*
 * Las empresas del grupo que facturan. Cada factura (y su recibo) es de una.
 * Sin nada de la base: lo usan también las pantallas y los PDF.
 */

export type Company = { key: CompanyKey; legalName: string; short: string; brand: string; address: string; vat?: string; cuit: string; iibb?: string; since?: string };

export const COMPANY_KEYS = ["tvp", "constructora"] as const;
export type CompanyKey = (typeof COMPANY_KEYS)[number];

export const COMPANIES: Record<CompanyKey, Company> = {
  tvp: {
    key: "tvp", legalName: "Trabajos Verticales Pino S.A.S.", short: "TV Pino", brand: "Pino Soluciones Técnicas",
    address: "Av. Maipú 1278 - 3400 - Corrientes", vat: "IVA Responsable Inscripto", cuit: "30-71629563-6", iibb: "30-71629563-6", since: "10/2022",
  },
  constructora: {
    key: "constructora", legalName: "Constructora Pino S.R.L.", short: "Constructora Pino", brand: "Constructora Pino",
    address: "Av. Maipú 1278 - 3400 - Corrientes", cuit: "30-71758997-8",
  },
};

/** La empresa de una factura; las viejas, sin empresa cargada, son de Trabajos Verticales Pino. */
export function companyOf(key?: unknown): Company {
  return COMPANIES[key as CompanyKey] || COMPANIES.tvp;
}
