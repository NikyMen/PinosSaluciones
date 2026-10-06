/*
 * Las empresas del grupo que facturan. Cada factura (y su recibo) es de una.
 * Sin nada de la base: lo usan también las pantallas y los PDF.
 */

export type Company = {
  key: CompanyKey; legalName: string; short: string; brand: string; address: string; vat?: string; cuit: string; iibb?: string; since?: string;
  /** Para transferir: salen en recibos y facturas de esta empresa. Vacíos hasta que administración los pase. */
  bank?: string; account?: string; cbu?: string; alias?: string;
};

export const COMPANY_KEYS = ["tvp", "constructora"] as const;
export type CompanyKey = (typeof COMPANY_KEYS)[number];

export const COMPANIES: Record<CompanyKey, Company> = {
  tvp: {
    key: "tvp", legalName: "Trabajos Verticales Pino S.A.S.", short: "TV Pino", brand: "Pino Soluciones Técnicas",
    address: "Av. Maipú 1278 - 3400 - Corrientes", vat: "IVA Responsable Inscripto", cuit: "30-71629563-6", iibb: "30-71629563-6", since: "10/2022",
    bank: "", account: "", cbu: "", alias: "",
  },
  constructora: {
    key: "constructora", legalName: "Constructora Pino S.R.L.", short: "Constructora Pino", brand: "Constructora Pino",
    address: "Av. Maipú 1278 - 3400 - Corrientes", vat: "IVA Responsable Inscripto", cuit: "30-71758997-8",
    bank: "", account: "", cbu: "", alias: "",
  },
};

/** "Banco Nación · Cta. 123 · CBU … · Alias …", o nada si todavía no se cargaron los datos. */
export function bankLines(company: Company) {
  const parts = [company.bank, company.account && `Cuenta ${company.account}`, company.cbu && `CBU ${company.cbu}`, company.alias && `Alias ${company.alias}`].filter(Boolean) as string[];
  return parts.length ? [`Datos para transferir a ${company.legalName}: ${parts.join(" · ")}`] : [];
}

/** La empresa de una factura; las viejas, sin empresa cargada, son de Trabajos Verticales Pino. */
export function companyOf(key?: unknown): Company {
  return COMPANIES[key as CompanyKey] || COMPANIES.tvp;
}
