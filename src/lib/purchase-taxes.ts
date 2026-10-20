/*
 * Los impuestos de una solicitud de compra (reunión con Tesorería, octubre de
 * 2026). Todo sale del neto: el IVA de cada renglón con su alícuota (21 %,
 * 10,5 % o 27 %; si el renglón no dice, la de la solicitud), y sobre el neto
 * total las percepciones (de IVA, de IIBB e IIBB provincial) y el impuesto
 * interno, con el porcentaje que se cargue. El total no se escribe a mano: es
 * neto + IVA + percepciones + impuesto interno. Sin nada de la base: lo usan
 * el pedido, el formulario, el servidor y el PDF.
 */

export const PURCHASE_VAT_RATES = [21, 10.5, 27] as const;
export const DEFAULT_PURCHASE_VAT_PCT = 21;

/** Las percepciones, cada una con su porcentaje y su importe en la solicitud. */
export const PURCHASE_PERCEPTIONS = [
  { key: "perceptionVat", label: "Percepción de IVA" },
  { key: "perceptionIibb", label: "Percepción de IIBB" },
  { key: "perceptionIibbProv", label: "IIBB provincial" },
] as const;
export type PerceptionKey = typeof PURCHASE_PERCEPTIONS[number]["key"];

/** Los porcentajes que se cargan en la solicitud. */
export const PURCHASE_TAX_PCT_KEYS = ["vatPct", "perceptionVatPct", "perceptionIibbPct", "perceptionIibbProvPct", "internalTaxPct"] as const;
/** Lo que el sistema calcula y guarda: no se toca a mano. */
export const PURCHASE_TAX_CENTS_KEYS = ["vatCents", "perceptionVatCents", "perceptionIibbCents", "perceptionIibbProvCents", "internalTaxCents", "amountCents"] as const;

export type PurchaseTaxRates = { vatPct?: number; perceptionVatPct?: number; perceptionIibbPct?: number; perceptionIibbProvPct?: number; internalTaxPct?: number };
export type TaxedLine = { totalCents: number; vatPct?: number | null };

export type PurchaseTotals = {
  subtotalCents: number;
  /** El IVA por alícuota, de menor a mayor: así va en el PDF. */
  vatByRate: Array<{ pct: number; baseCents: number; vatCents: number }>;
  vatCents: number;
  perceptionVatCents: number; perceptionIibbCents: number; perceptionIibbProvCents: number;
  perceptionsCents: number;
  internalTaxCents: number;
  amountCents: number;
};

export const isPurchaseVatRate = (value: unknown) => PURCHASE_VAT_RATES.some(rate => rate === Number(value));
const pct = (value: unknown) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; };
const share = (cents: number, percent: number) => Math.round(cents * percent / 100);
/** Cómo se lee un porcentaje: "10,5 %". */
export const pctLabel = (value: number) => `${String(Math.round(value * 100) / 100).replace(".", ",")} %`;

/** La alícuota de un renglón: la suya o, si no tiene, la de la solicitud. */
export function lineVatPct(line: { vatPct?: number | null }, requestVatPct?: number) {
  if (isPurchaseVatRate(line.vatPct)) return Number(line.vatPct);
  return isPurchaseVatRate(requestVatPct) ? Number(requestVatPct) : DEFAULT_PURCHASE_VAT_PCT;
}

/** Los totales de una solicitud: con renglones, el IVA de cada uno; sin renglones, el neto entero a la alícuota de la solicitud. */
export function purchaseTotals(lines: TaxedLine[], rates: PurchaseTaxRates = {}): PurchaseTotals {
  const bases = new Map<number, number>();
  for (const line of lines) {
    const rate = lineVatPct(line, rates.vatPct);
    bases.set(rate, (bases.get(rate) || 0) + Math.round(Number(line.totalCents || 0)));
  }
  const vatByRate = [...bases.entries()].sort(([a], [b]) => a - b).map(([rate, baseCents]) => ({ pct: rate, baseCents, vatCents: share(baseCents, rate) }));
  const subtotalCents = vatByRate.reduce((total, row) => total + row.baseCents, 0);
  const vatCents = vatByRate.reduce((total, row) => total + row.vatCents, 0);
  const perceptionVatCents = share(subtotalCents, pct(rates.perceptionVatPct));
  const perceptionIibbCents = share(subtotalCents, pct(rates.perceptionIibbPct));
  const perceptionIibbProvCents = share(subtotalCents, pct(rates.perceptionIibbProvPct));
  const perceptionsCents = perceptionVatCents + perceptionIibbCents + perceptionIibbProvCents;
  const internalTaxCents = share(subtotalCents, pct(rates.internalTaxPct));
  return { subtotalCents, vatByRate, vatCents, perceptionVatCents, perceptionIibbCents, perceptionIibbProvCents, perceptionsCents, internalTaxCents, amountCents: subtotalCents + vatCents + perceptionsCents + internalTaxCents };
}

/**
 * Los porcentajes y el neto que tiene guardados una compra, con lo que vale
 * para las de antes: 21 % de IVA, sin percepciones y, si sólo tenía el total
 * con IVA, el neto que sale de ese total.
 */
export function storedPurchaseTaxes(record: Record<string, unknown>) {
  const items = Array.isArray(record.items) ? record.items as TaxedLine[] : [];
  const vatPct = isPurchaseVatRate(record.vatPct) ? Number(record.vatPct) : DEFAULT_PURCHASE_VAT_PCT;
  const subtotalCents = typeof record.subtotalCents === "number" ? record.subtotalCents
    : items.length ? items.reduce((total, line) => total + Number(line.totalCents || 0), 0)
      : Math.round(Number(record.amountCents || 0) / (1 + vatPct / 100));
  return {
    subtotalCents, vatPct,
    perceptionVatPct: pct(record.perceptionVatPct), perceptionIibbPct: pct(record.perceptionIibbPct), perceptionIibbProvPct: pct(record.perceptionIibbProvPct),
    internalTaxPct: pct(record.internalTaxPct),
  };
}

/** Lo que se guarda en la compra a partir de sus renglones (o de su neto) y sus porcentajes. */
export function purchaseTaxFields(lines: TaxedLine[], rates: PurchaseTaxRates) {
  const totals = purchaseTotals(lines, rates);
  return {
    subtotalCents: totals.subtotalCents, vatPct: lineVatPct({}, rates.vatPct), vatCents: totals.vatCents,
    perceptionVatPct: pct(rates.perceptionVatPct), perceptionVatCents: totals.perceptionVatCents,
    perceptionIibbPct: pct(rates.perceptionIibbPct), perceptionIibbCents: totals.perceptionIibbCents,
    perceptionIibbProvPct: pct(rates.perceptionIibbProvPct), perceptionIibbProvCents: totals.perceptionIibbProvCents,
    internalTaxPct: pct(rates.internalTaxPct), internalTaxCents: totals.internalTaxCents,
    amountCents: totals.amountCents,
  };
}

/**
 * Los importes de un comprobante del proveedor (factura o nota de compra) a
 * partir de su neto: el IVA a su alícuota sólo si lo discrimina (la A; la C y
 * la X no), y las percepciones y el impuesto interno sobre el neto, en
 * cualquier comprobante. El total es la suma.
 */
export function voucherTaxFields(netCents: number, rates: PurchaseTaxRates, discriminatesVat: boolean) {
  const net = Math.round(Number(netCents || 0));
  // Sin alícuota, 21 %; una A exenta puede venir al 0 %.
  const vatPct = !discriminatesVat ? 0 : rates.vatPct === undefined || rates.vatPct === null || !Number.isFinite(Number(rates.vatPct)) ? DEFAULT_PURCHASE_VAT_PCT : pct(rates.vatPct);
  const vatCents = share(net, vatPct);
  const fields = {
    netCents: net, vatPct, vatCents,
    perceptionVatPct: pct(rates.perceptionVatPct), perceptionVatCents: share(net, pct(rates.perceptionVatPct)),
    perceptionIibbPct: pct(rates.perceptionIibbPct), perceptionIibbCents: share(net, pct(rates.perceptionIibbPct)),
    perceptionIibbProvPct: pct(rates.perceptionIibbProvPct), perceptionIibbProvCents: share(net, pct(rates.perceptionIibbProvPct)),
    internalTaxPct: pct(rates.internalTaxPct), internalTaxCents: share(net, pct(rates.internalTaxPct)),
  };
  return { ...fields, amountCents: net + vatCents + fields.perceptionVatCents + fields.perceptionIibbCents + fields.perceptionIibbProvCents + fields.internalTaxCents };
}

/**
 * Los renglones de impuestos de una compra guardada, para mostrarla (ficha,
 * PDF): el IVA de cada alícuota y las percepciones y el impuesto interno que
 * no son cero. Una compra de antes, sin el detalle, muestra sólo el IVA.
 */
export function purchaseTaxRows(record: Record<string, unknown>) {
  const stored = storedPurchaseTaxes(record);
  // Una de antes: todo al 21 % y el IVA es lo que va del neto al total.
  if (record.vatPct === undefined) {
    const vat = typeof record.vatCents === "number" ? record.vatCents : Math.max(0, Number(record.amountCents || 0) - stored.subtotalCents);
    return { subtotalCents: stored.subtotalCents, rows: [{ label: `IVA ${pctLabel(DEFAULT_PURCHASE_VAT_PCT)}`, cents: vat }] };
  }
  const items = Array.isArray(record.items) && record.items.length ? record.items as TaxedLine[] : [{ totalCents: stored.subtotalCents }];
  const totals = purchaseTotals(items, stored);
  const rows: Array<{ label: string; cents: number }> = totals.vatByRate.map(row => ({ label: `IVA ${pctLabel(row.pct)}`, cents: row.vatCents }));
  for (const { key, label } of PURCHASE_PERCEPTIONS) {
    const percent = stored[`${key}Pct` as const];
    if (percent > 0) rows.push({ label: `${label} ${pctLabel(percent)}`, cents: Number(record[`${key}Cents`] ?? totals[`${key}Cents` as const]) });
  }
  if (stored.internalTaxPct > 0) rows.push({ label: `Impuesto interno ${pctLabel(stored.internalTaxPct)}`, cents: Number(record.internalTaxCents ?? totals.internalTaxCents) });
  return { subtotalCents: stored.subtotalCents, rows };
}
