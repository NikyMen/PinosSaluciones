/**
 * La cascada: las cuentas que van del costo directo al precio final, en un solo
 * lugar. Las usa la API al guardar y la pantalla del cotizador al mostrar los
 * numeros mientras se tipea, igual que labor.ts con los partes diarios.
 *
 * Es la traduccion de las 7 planillas de analisis de precios que usa la empresa.
 * El relevamiento celda por celda esta en docs/modelo-datos/cascada-comparativa.md
 * y esos 7 libros son los casos de prueba de tests/cascada.test.ts.
 *
 * Dos cosas que conviene tener presentes antes de tocar nada:
 *
 * 1. Los porcentajes se aplican EN CASCADA, no acumulados: cada escalon toma el
 *    subtotal del anterior. Sumar los porcentajes y aplicarlos de una da otro numero.
 * 2. El coeficiente k = precio / costo directo es la bisagra de todo. La pestaña
 *    Precio no vuelve a recorrer la cascada: multiplica el costo unitario de cada
 *    item por ese unico numero. Si k sale bien, todo lo demas sale.
 *
 * Las cuentas van en centavos como float y se redondean recien al salir: nueve
 * multiplicaciones porcentuales encadenadas no toleran redondear en cada paso.
 */

export type Rubro = "MAT" | "MO" | "EQUIPOS";

export const rubroLabels: Record<Rubro, string> = {
  MAT: "Materiales",
  MO: "Mano de obra",
  EQUIPOS: "Equipos",
};

/** Un insumo dentro de un item: la cantidad es un coeficiente de consumo por unidad de obra. */
export type Insumo = {
  rubro: Rubro;
  /** Codigo de articulo (110041). Opcional: casi siempre solo lo tienen los materiales. */
  code?: string;
  /** La denominacion es ademas la clave con la que se agrupa la lista de compras. */
  name: string;
  /** hs, lts, kg, U, bolsa, rollo, m2, dia, mes, km. Texto libre: el enum de stock no alcanza. */
  unit: string;
  /** Consumo por unidad de obra: 0,4 lts de latex por m2. */
  coefPerUnit: number;
  /** Precio del insumo EN SU MONEDA. Si es USD se convierte con fxRate. */
  unitPriceCents: number;
  currency?: "ARS" | "USD";
  /** Cotizacion del dia con la que se cotizo. Se congela: si mañana cambia el dolar, esto no. */
  fxRate?: number;
  /** De donde salio el precio, si vino del catalogo. El precio igual queda congelado aca. */
  stockItemId?: string;
  workerId?: string;
  /** Cuanta gente hace falta para ese insumo. Solo tiene sentido en mano de obra. */
  personas?: number;
};

/** Un item de obra cotizable: 1.1, 5.7. La cantidad es la real (5.250 m2), no un coeficiente. */
export type QuoteItem = {
  code?: string;
  name: string;
  unit: string;
  qty: number;
  composition: Insumo[];
};

export type OverheadFormula = "impuesto_cheque" | "representacion_tecnica" | "mes_hombre";

/** Una linea de gastos generales directos, sobre el catalogo de cascada-conceptos.ts. */
export type OverheadLine = {
  conceptKey: string;
  group: string;
  label: string;
  unit: string;
  qty: number;
  unitPriceCents: number;
  /** Las tres lineas que en las planillas son formula y no dato tipeado. */
  formula?: OverheadFormula;
  /** El porcentaje de la formula: 0,6 / 1 / 1,2 para el cheque; 3 para representacion tecnica. */
  formulaPct?: number;
  /** Solo para el prorrateo mes-hombre. Si no vienen, salen de la dotacion de los items. */
  personas?: number;
  dias?: number;
};

export type IvaBase = "st2" | "st3";

export type CascadeParams = {
  ggiPct: number;
  benefitPct: number;
  financialPct: number;
  iibbPct: number;
  ivaPct: number;
  ivaBase: IvaBase;
  /** Impuesto al cheque: porcentaje sobre el total de materiales. */
  chequePct: number;
};

/** Los defaults son los de las 7 planillas, no inventados. Ver cascada-comparativa.md §4. */
export const defaultCascadeParams: CascadeParams = {
  ggiPct: 18,
  benefitPct: 30,
  financialPct: 0,
  iibbPct: 2.5,
  ivaPct: 21,
  ivaBase: "st2",
  chequePct: 0,
};

/** Dias que tiene un mes de trabajo para prorratear un costo mensual. En las planillas, 25. */
export const DIAS_MES = 25;
/** Horas de una jornada, para pasar de horas de mano de obra a dias de obra. */
export const HORAS_JORNADA = 8;

export type ComputedInsumo = Insumo & {
  /** El precio ya pasado a pesos: si estaba en dolares, por la cotizacion congelada. */
  arsUnitPriceCents: number;
  /** Lo que ese insumo cuesta por cada unidad de obra. */
  unitCostCents: number;
  /** Cantidad total absoluta = coeficiente x cantidad del item. */
  totalQty: number;
  /** Costo total del insumo en la obra. */
  totalCostCents: number;
};

export type ComputedItem = {
  code?: string;
  name: string;
  unit: string;
  qty: number;
  composition: ComputedInsumo[];
  /** Costo por unidad de obra: la suma de sus insumos. Es el numero que despues se multiplica por k. */
  unitCostCents: number;
  costCents: number;
  /** Precio unitario y total al cliente = costo x k. */
  unitPriceCents: number;
  priceCents: number;
};

export type ComputedOverhead = OverheadLine & {
  /** La cantidad efectiva: la tipeada, o la que sale de la formula. */
  computedQty: number;
  amountCents: number;
};

export type CascadeResult = {
  items: ComputedItem[];
  overheads: ComputedOverhead[];
  /** 1 — costo directo, abierto por rubro. */
  materialsCents: number;
  laborCents: number;
  equipmentCents: number;
  directCostCents: number;
  /** 2 — gastos generales directos. */
  ggdCents: number;
  /** 3 — costo = 1 + 2. */
  costCents: number;
  /** 4 y 5. */
  ggiCents: number;
  subtotal1Cents: number;
  /** 6 y 7. */
  benefitCents: number;
  financialCents: number;
  subtotal2Cents: number;
  /** 8. */
  iibbCents: number;
  subtotal3Cents: number;
  /** 9. */
  ivaBaseCents: number;
  ivaCents: number;
  priceCents: number;
  /** La bisagra. Sin redondear: se usa para multiplicar, no para mostrar. */
  k: number;
  /** Incidencia de cada bloque sobre el precio final. Las planillas usaban dos bases distintas: aca se fija una. */
  shares: { materials: number; labor: number; equipment: number; ggd: number; ggi: number; benefit: number; taxes: number };
  /** Cuanta gente y cuantos dias sale de la propia mano de obra cargada. */
  dotacion: { horas: number; dias: number; personas: number };
};

/** Precio del insumo pasado a pesos. Los dolarizados guardan el precio en USD y la cotizacion del dia. */
function arsUnitPrice(insumo: Insumo) {
  const price = Number(insumo.unitPriceCents) || 0;
  if (insumo.currency !== "USD") return price;
  return price * (Number(insumo.fxRate) || 0);
}

/** Las horas de mano de obra vienen en unidades distintas segun quien cargo la planilla. */
function isHourUnit(unit: string) {
  return /^(hs|hr|h|hora|horas)$/i.test(String(unit || "").trim());
}

export function computeCascade(input: { items: QuoteItem[]; overheads?: OverheadLine[]; params?: Partial<CascadeParams> }): CascadeResult {
  const params = { ...defaultCascadeParams, ...(input.params || {}) };
  const pct = (value: number) => (Number(value) || 0) / 100;

  // 1 — costo directo: cada insumo por su coeficiente, agrupado por rubro.
  let materials = 0, labor = 0, equipment = 0;
  let horas = 0, personasMax = 0;

  const items: ComputedItem[] = (input.items || []).map(item => {
    const qty = Number(item.qty) || 0;
    const composition: ComputedInsumo[] = (item.composition || []).map(insumo => {
      const price = arsUnitPrice(insumo);
      const coef = Number(insumo.coefPerUnit) || 0;
      const unitCostCents = coef * price;
      const totalQty = coef * qty;
      const totalCostCents = unitCostCents * qty;
      if (insumo.rubro === "MO") {
        labor += totalCostCents;
        if (isHourUnit(insumo.unit)) horas += totalQty;
        personasMax = Math.max(personasMax, Number(insumo.personas) || 0);
      } else if (insumo.rubro === "EQUIPOS") equipment += totalCostCents;
      else materials += totalCostCents;
      return { ...insumo, arsUnitPriceCents: price, unitCostCents, totalQty, totalCostCents };
    });
    const unitCostCents = composition.reduce((total, insumo) => total + insumo.unitCostCents, 0);
    return { ...item, qty, composition, unitCostCents, costCents: unitCostCents * qty, unitPriceCents: 0, priceCents: 0 };
  });

  const directCost = materials + labor + equipment;
  const diasTotales = horas / HORAS_JORNADA;
  const dotacion = { horas: round2(horas), dias: round2(diasTotales), personas: personasMax };

  // 2 — gastos generales directos. Tres conceptos son formula y no dato tipeado.
  const overheads: ComputedOverhead[] = (input.overheads || []).map(line => {
    const unitPrice = Number(line.unitPriceCents) || 0;
    if (line.formula === "impuesto_cheque") {
      return { ...line, computedQty: 0, amountCents: materials * pct(line.formulaPct ?? params.chequePct) };
    }
    if (line.formula === "representacion_tecnica") {
      return { ...line, computedQty: 0, amountCents: directCost * pct(line.formulaPct ?? 0) };
    }
    if (line.formula === "mes_hombre") {
      // El prorrateo que la gente hace a mano: =7*78/25 son 7 personas, 78 dias, 25 dias-mes.
      const gente = Number(line.personas) || personasMax;
      const dias = Number(line.dias) || diasTotales;
      const computedQty = (gente * dias) / DIAS_MES;
      return { ...line, computedQty: round2(computedQty), amountCents: computedQty * unitPrice };
    }
    const computedQty = Number(line.qty) || 0;
    return { ...line, computedQty, amountCents: computedQty * unitPrice };
  });

  const ggd = overheads.reduce((total, line) => total + line.amountCents, 0);

  // 3 a 9 — la cascada propiamente dicha.
  const cost = directCost + ggd;
  const ggi = cost * pct(params.ggiPct);
  const subtotal1 = cost + ggi;
  const benefit = subtotal1 * pct(params.benefitPct);
  const financial = subtotal1 * pct(params.financialPct);
  const subtotal2 = subtotal1 + benefit + financial;
  const iibb = subtotal2 * pct(params.iibbPct);
  const subtotal3 = subtotal2 + iibb;
  const ivaBase = params.ivaBase === "st3" ? subtotal3 : subtotal2;
  const iva = ivaBase * pct(params.ivaPct);
  const price = subtotal3 + iva;

  const k = directCost > 0 ? price / directCost : 0;
  const share = (value: number) => (price > 0 ? round2((value / price) * 100) : 0);

  for (const item of items) {
    item.unitPriceCents = Math.round(item.unitCostCents * k);
    item.priceCents = Math.round(item.costCents * k);
  }

  return {
    items,
    overheads: overheads.map(line => ({ ...line, amountCents: Math.round(line.amountCents) })),
    materialsCents: Math.round(materials),
    laborCents: Math.round(labor),
    equipmentCents: Math.round(equipment),
    directCostCents: Math.round(directCost),
    ggdCents: Math.round(ggd),
    costCents: Math.round(cost),
    ggiCents: Math.round(ggi),
    subtotal1Cents: Math.round(subtotal1),
    benefitCents: Math.round(benefit),
    financialCents: Math.round(financial),
    subtotal2Cents: Math.round(subtotal2),
    iibbCents: Math.round(iibb),
    subtotal3Cents: Math.round(subtotal3),
    ivaBaseCents: Math.round(ivaBase),
    ivaCents: Math.round(iva),
    priceCents: Math.round(price),
    k,
    shares: {
      materials: share(materials), labor: share(labor), equipment: share(equipment),
      ggd: share(ggd), ggi: share(ggi), benefit: share(benefit + financial), taxes: share(iibb + iva),
    },
    dotacion,
  };
}

/**
 * El camino inverso: fijar el precio y despejar el beneficio. Es lo que hicieron a
 * mano con Goal Seek en POLIUREA, donde quedo un beneficio de 34,777129088592147 %
 * porque el precio de venta era el numero redondo y el margen la incognita.
 *
 * No hace falta iterar: la cascada es lineal en el beneficio.
 *
 *   PRECIO = SUB TOTAL 1 x (1 + b + financiero) x M
 *   con M = (1 + iibb) + iva x (base ST3 ? (1 + iibb) : 1)
 *
 * Devuelve null si todavia no hay costo cargado. Puede devolver un beneficio
 * negativo: eso significa que el precio pedido no cubre el costo, y hay que
 * avisarlo en pantalla en vez de guardarlo callado.
 */
export function solveBenefitPct(input: { items: QuoteItem[]; overheads?: OverheadLine[]; params?: Partial<CascadeParams> }, targetPriceCents: number) {
  const params = { ...defaultCascadeParams, ...(input.params || {}) };
  // Con beneficio 0 el subtotal 1 no cambia: sirve para despejar sin recursion.
  const base = computeCascade({ ...input, params: { ...params, benefitPct: 0 } });
  const subtotal1 = base.subtotal1Cents;
  if (subtotal1 <= 0) return null;
  const iibb = (Number(params.iibbPct) || 0) / 100;
  const iva = (Number(params.ivaPct) || 0) / 100;
  const multiplier = (1 + iibb) + iva * (params.ivaBase === "st3" ? 1 + iibb : 1);
  if (multiplier <= 0) return null;
  return ((Number(targetPriceCents) || 0) / (subtotal1 * multiplier) - 1 - (Number(params.financialPct) || 0) / 100) * 100;
}

/**
 * Lo mismo pero pidiendo un precio unitario para un item: como k es unico para toda
 * la cotizacion, fijar el precio de un item fija el precio de todos.
 */
export function targetPriceFromUnitPrice(result: CascadeResult, itemIndex: number, targetUnitPriceCents: number) {
  const item = result.items[itemIndex];
  if (!item || item.unitCostCents <= 0 || result.directCostCents <= 0) return null;
  return Math.round(((Number(targetUnitPriceCents) || 0) / item.unitCostCents) * result.directCostCents);
}

/**
 * La lista de compras: la composicion de todos los items agrupada por insumo.
 * Es el SUMIF por DENOMINACION de la pestaña Insumos.
 */
export function insumosSummary(result: CascadeResult) {
  const groups = new Map<string, { rubro: Rubro; code?: string; name: string; unit: string; totalQty: number; totalCostCents: number }>();
  for (const item of result.items) {
    for (const insumo of item.composition) {
      const key = [insumo.rubro, insumo.name.trim().toLowerCase(), insumo.unit.trim().toLowerCase()].join("|");
      const current = groups.get(key);
      if (current) {
        current.totalQty += insumo.totalQty;
        current.totalCostCents += insumo.totalCostCents;
      } else {
        groups.set(key, { rubro: insumo.rubro, code: insumo.code, name: insumo.name, unit: insumo.unit, totalQty: insumo.totalQty, totalCostCents: insumo.totalCostCents });
      }
    }
  }
  return [...groups.values()]
    .map(row => ({ ...row, totalQty: round2(row.totalQty), totalCostCents: Math.round(row.totalCostCents) }))
    .sort((a, b) => b.totalCostCents - a.totalCostCents);
}

/**
 * El coeficiente casi nunca se escribe como coeficiente: la gente piensa en total y
 * divide. En las planillas aparece como =80/E11 (80 lijas en 5.250 m2) o =8/15
 * (8 horas cada 15 m2). Aca se acepta "0,4", "80/5250" y "8/15" por igual.
 */
export function parseCoef(value: string) {
  const clean = String(value ?? "").trim().replace(/^=/, "").replace(/\s/g, "");
  if (!clean) return 0;
  const division = /^(-?[\d.,]+)\/(-?[\d.,]+)$/.exec(clean);
  if (division) {
    const divisor = decimal(division[2]);
    return divisor === 0 ? 0 : decimal(division[1]) / divisor;
  }
  return decimal(clean);
}

/** "1.234,5" y "1234.5" quieren decir lo mismo cuando alguien tipea un coeficiente. */
function decimal(value: string) {
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
