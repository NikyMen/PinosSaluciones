/*
 * Listas de precios de proveedores.
 *
 * Cada proveedor manda su Excel con su propio formato. Acá se lee la planilla
 * tal como llega: se busca la fila de títulos (código, producto, precio), se
 * toman los rubros de las filas sueltas que separan los bloques y se arma un
 * producto por cada fila que tiene precio. Nada de esto toca la base: son
 * cuentas puras, para poder probarlas con planillas armadas a mano.
 */

export const VAT_RATE = 0.21;

export const priceFields = ["code", "name", "description", "presentation", "minSale", "price", "kind"] as const;
export type PriceField = (typeof priceFields)[number];
export type ColumnMap = Partial<Record<PriceField, number>>;
/** Dónde está cada dato en la planilla: la hoja, la fila de títulos y la columna de cada campo. */
export type PriceLayout = { sheet: string; headerRow: number; columns: ColumnMap };

export const priceFieldLabels: Record<PriceField, string> = {
  code: "Código", name: "Producto", description: "Descripción", presentation: "Presentación",
  minSale: "Mínimo de venta", price: "Precio", kind: "Tipo / disponibilidad",
};

export type ParsedPriceItem = {
  /** Fila del Excel (contando desde 1), para poder señalarla en los avisos. */
  row: number;
  code: string; name: string; description: string; presentation: string; minSale: string;
  category: string; subcategory: string; kind: string;
  listPriceCents: number;
};

export type MeasureUnit = "kg" | "litro" | "m2" | "m3" | "metro";
export type Measure = { qty: number; unit: MeasureUnit };
export const measureLabels: Record<MeasureUnit, string> = { kg: "kg", litro: "litro", m2: "m²", m3: "m³", metro: "metro" };

/**
 * Un producto listo para mostrar: con el nombre del proveedor, la fecha de su
 * lista y lo que nos cuesta. Los importes van siempre SIN IVA; la pantalla lo
 * suma si la persona pide verlos con IVA.
 */
export type PriceRow = {
  _id: string; supplierId: string; supplierName: string; discountPct: number;
  listId: string; validFrom: string;
  code: string; name: string; description: string; presentation: string; minSale: string;
  category: string; subcategory: string; kind: string; kindLabel: string;
  /** Precio de lista. */ listCents: number;
  /** Precio de lista menos el descuento del proveedor. */ ownCents: number;
  /** Precio de lista que tenía en la lista anterior. */ previousCents: number | null;
  measure: Measure | null;
  /** La lista tiene más de tres meses: el precio puede haber cambiado. */ stale: boolean;
  best?: boolean;
};

/** Protex actualiza cada dos o tres meses: una lista más vieja que esto ya no es confiable. */
export const STALE_AFTER_DAYS = 90;

/* ── Texto ─────────────────────────────────────────────────────────────────── */

/** Minúsculas, sin acentos y sin espacios de más: la forma en que se compara todo. */
export function normalize(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** El texto de una celda, con los saltos de línea del Excel convertidos en espacios. */
export function cellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, " ").trim();
}

/** "MORTEROS CEMENTICIOS" → "Morteros cementicios". Los rubros vienen gritados. */
function sentenceCase(value: string) {
  const lower = value.toLocaleLowerCase("es-AR");
  return lower.charAt(0).toLocaleUpperCase("es-AR") + lower.slice(1);
}

/* ── Precios ───────────────────────────────────────────────────────────────── */

/**
 * Un precio tal como puede venir en una celda: número, "$ 217.025,50",
 * "217025.5" o "1,234.50". Devuelve pesos, o 0 si ahí no hay un precio.
 */
export function parsePrice(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  if (typeof value !== "string") return 0;
  let text = value.replace(/[^\d.,]/g, "");
  if (!/\d/.test(text)) return 0;
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // El separador que aparece último es el decimal; el otro agrupa miles.
    text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    text = (text.match(/,/g) || []).length > 1 ? text.replace(/,/g, "") : text.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    // "217.025" es doscientos diecisiete mil, no doscientos diecisiete.
    text = text.replace(/\./g, "");
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export const withVat = (cents: number) => Math.round(cents * (1 + VAT_RATE));
export const withoutVat = (cents: number) => Math.round(cents / (1 + VAT_RATE));
/** Lo que paga la empresa: el precio de lista menos el descuento acordado con el proveedor. */
export const discounted = (cents: number, discountPct: number) => Math.round(cents * (1 - (Number(discountPct) || 0) / 100));

/* ── Medidas: para comparar un balde de 20 kg con uno de 5 kg ──────────────── */

// "ML" queda afuera a propósito: en la misma lista es metro lineal (junta de
// 20 ML) y mililitro (cartucho de 300ML). Antes que adivinar, no se compara.
const measurePattern = /(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|kilogramos?|grs?|gramos?|g|lts?|litros?|l|cc|m2|m²|mts2|m3|m³)(?![a-z0-9])/;

function readMeasure(text: string): Measure | null {
  const match = measurePattern.exec(normalize(text).replace(/\bm\s+2\b/g, "m2").replace(/\bm\s+3\b/g, "m3"));
  if (!match) return null;
  const qty = Number(match[1].replace(",", "."));
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const unit = match[2];
  if (/^(kgs?|kilos?|kilogramos?)$/.test(unit)) return { qty, unit: "kg" };
  if (/^(grs?|gramos?|g)$/.test(unit)) return { qty: qty / 1000, unit: "kg" };
  if (/^(lts?|litros?|l)$/.test(unit)) return { qty, unit: "litro" };
  if (unit === "cc") return { qty: qty / 1000, unit: "litro" };
  if (/^(m2|m²|mts2)$/.test(unit)) return { qty, unit: "m2" };
  return { qty, unit: "m3" };
}

/** Un mínimo de venta que es una medida sin cantidad: "M2", "Por metro", "kg". */
function bareUnit(text: string): Measure | null {
  const match = /^(?:por\s+)?(kgs?|kilos?|m2|m²|metros?|mts?|litros?|lts?)$/.exec(normalize(text));
  if (!match) return null;
  const unit = match[1];
  if (/^(kgs?|kilos?)$/.test(unit)) return { qty: 1, unit: "kg" };
  if (/^(m2|m²)$/.test(unit)) return { qty: 1, unit: "m2" };
  if (/^(litros?|lts?)$/.test(unit)) return { qty: 1, unit: "litro" };
  return { qty: 1, unit: "metro" };
}

/**
 * Cuánto material cubre el precio de una fila.
 *
 * Si se vende por envase ("1 Unidad", "Rollo"), el precio es el del envase y la
 * medida sale de la presentación ("Balde 20 KG" → 20 kg). Si se vende por
 * medida ("M2", "Por metro"), el precio ya es por esa medida. Cuando las dos
 * cosas se contradicen (un kit de 21 kg que se vende "por M2") no se calcula
 * nada: un precio por kilo inventado es peor que no tenerlo.
 */
export function measureOf(presentation: string, minSale: string): Measure | null {
  const size = readMeasure(presentation);
  const sale = readMeasure(minSale) ?? bareUnit(minSale);
  if (!sale) return size;
  if (size && size.unit !== sale.unit) return null;
  return sale;
}

/* ── Encontrar la fila de títulos ──────────────────────────────────────────── */

const synonyms: Record<PriceField, string[]> = {
  code: ["codigo", "cod", "cod.", "cod art", "cod. art", "codigo articulo", "codigo de articulo", "sku", "referencia", "ref", "ref."],
  name: ["producto", "productos", "nombre", "articulo", "denominacion"],
  description: ["descripcion", "detalle", "descripcion del producto"],
  presentation: ["presentacion", "envase", "formato", "empaque", "contenido"],
  minSale: ["min. venta", "min venta", "minimo de venta", "venta minima", "minimo", "unidad de venta", "u. de venta", "cant. minima"],
  price: ["precio", "precios", "precio lista", "precio de lista", "p. lista", "precio unitario", "precio sin iva", "precio s/iva", "precio neto", "importe", "valor"],
  kind: ["tipo", "disponibilidad"],
};

function fieldForHeader(header: string): PriceField | null {
  const text = normalize(header);
  if (!text) return null;
  for (const field of priceFields) if (synonyms[field].includes(text)) return field;
  // "PRECIO CON IVA", "Precio $ oct-26": empieza con uno de los nombres.
  for (const field of priceFields) if (synonyms[field].some(name => name.length >= 5 && text.startsWith(`${name} `))) return field;
  return null;
}

function layoutFromHeader(row: unknown[]): ColumnMap | null {
  const columns: ColumnMap = {};
  row.forEach((cell, index) => {
    const field = fieldForHeader(cellText(cell));
    if (field && columns[field] === undefined) columns[field] = index;
  });
  // Sin columna de producto, la descripción hace de nombre.
  if (columns.name === undefined && columns.description !== undefined) { columns.name = columns.description; delete columns.description; }
  return columns.price !== undefined && columns.name !== undefined ? columns : null;
}

/** La primera fila que tiene título de precio y de producto. */
export function detectLayout(sheet: string, rows: unknown[][]): PriceLayout | null {
  for (let index = 0; index < Math.min(rows.length, 60); index++) {
    const columns = layoutFromHeader(rows[index] || []);
    if (columns) return { sheet, headerRow: index, columns };
  }
  return null;
}

/* ── Leer los productos ────────────────────────────────────────────────────── */

const numbered = /^\d{1,3}\s*[.)-]\s*(?=\S)/;

/** Una fila suelta en mayúsculas separa rubros; un aviso en minúsculas no. */
function sectionTitle(text: string) {
  if (text.length > 90 || text.includes("|") || /lista de precios|vigen/i.test(text)) return null;
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (!letters || letters !== letters.toLocaleUpperCase("es-AR")) return null;
  return { numbered: numbered.test(text), text: sentenceCase(text.replace(numbered, "").trim()) };
}

export type ParsedSheet = {
  items: ParsedPriceItem[];
  /** Filas con datos que no se pudieron leer como producto (casi siempre, sin precio). */
  skipped: Array<{ row: number; text: string }>;
  /** Lo que significa cada letra de la columna "tipo", si la planilla lo aclara al pie. */
  legend: Record<string, string>;
};

export function parseSheet(rows: unknown[][], layout: PriceLayout): ParsedSheet {
  const { columns } = layout;
  const header = rows[layout.headerRow] || [];
  const width = Math.max(header.length, ...rows.map(row => row?.length || 0));
  const mapped = new Map<number, PriceField>();
  for (const field of priceFields) if (columns[field] !== undefined) mapped.set(columns[field]!, field);

  // Una columna sin título pegada a la derecha de otra es parte de ella: en
  // Protex la presentación dice "Balde" y la columna de al lado, "20 KG".
  const extras = new Map<PriceField, number[]>();
  let owner: PriceField | null = null;
  for (let column = 0; column < width; column++) {
    if (mapped.has(column)) { owner = mapped.get(column)!; continue; }
    if (cellText(header[column])) { owner = null; continue; }
    if (owner && ["name", "description", "presentation", "minSale"].includes(owner)) extras.set(owner, [...(extras.get(owner) || []), column]);
  }

  const headerPrice = normalize(cellText(header[columns.price!]));
  // Si la lista numera sus rubros, las filas sin número son subrubros; si no
  // numera nada, cada fila suelta es un rubro.
  const numberedSections = rows.some(row => {
    const filled = (row || []).map(cellText).filter(Boolean);
    return filled.length === 1 && sectionTitle(filled[0])?.numbered;
  });
  const items: ParsedPriceItem[] = [];
  const skipped: ParsedSheet["skipped"] = [];
  const legend: Record<string, string> = {};
  const seen = new Set<string>();
  let category = "";
  let subcategory = "";
  // El último producto leído: las filas que traen sólo otro tamaño heredan su nombre.
  let previous: { name: string; description: string; presentation: string } | null = null;

  const at = (row: unknown[], field: PriceField) => columns[field] === undefined ? "" : cellText(row[columns[field]!]);
  const extra = (row: unknown[], field: PriceField) => (extras.get(field) || []).map(column => cellText(row[column])).filter(Boolean).join(" ");

  rows.forEach((row = [], index) => {
    const filled = row.map(cellText).filter(Boolean);
    if (!filled.length || index === layout.headerRow) return;

    // Antes de los títulos sólo cuentan los rubros numerados ("01. IMPERMEABILIZANTES"):
    // lo demás es el membrete del proveedor.
    if (index < layout.headerRow) {
      const section = filled.length === 1 ? sectionTitle(filled[0]) : null;
      if (section?.numbered) { category = section.text; subcategory = ""; }
      return;
    }
    // Cada hoja impresa repite los títulos.
    if (headerPrice && normalize(at(row, "price")) === headerPrice) return;

    const price = parsePrice(row[columns.price!]);
    if (price > 0) {
      let name = [at(row, "name"), extra(row, "name")].filter(Boolean).join(" ");
      let description = [at(row, "description"), extra(row, "description")].filter(Boolean).join(" ");
      let base = at(row, "presentation");
      const inherited = !name && previous !== null;
      if (inherited) {
        name = previous!.name;
        description ||= previous!.description;
        base ||= previous!.presentation;
      }
      name ||= description || at(row, "code");
      if (!name) { skipped.push({ row: index + 1, text: filled.join(" · ") }); return; }
      const item: ParsedPriceItem = {
        row: index + 1, code: at(row, "code"), name, description,
        presentation: [base, extra(row, "presentation")].filter(Boolean).join(" "),
        minSale: [at(row, "minSale"), extra(row, "minSale")].filter(Boolean).join(" "),
        category, subcategory, kind: at(row, "kind"),
        listPriceCents: Math.round(price * 100),
      };
      previous = { name, description, presentation: base };
      // La lista de Protex trae una fila repetida tal cual: se guarda una sola vez.
      const fingerprint = [item.code, item.name, item.presentation, item.listPriceCents].map(normalize).join("|");
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);
      items.push(item);
      return;
    }

    if (filled.length === 1) {
      const section = sectionTitle(filled[0]);
      if (!section) return;
      if (section.numbered || !numberedSections) { category = section.text; subcategory = ""; }
      else subcategory = section.text;
      previous = null;
      return;
    }

    // El pie de Protex explica las letras: "A · PRODUCTOS DE STOCK".
    const letter = at(row, "code");
    if (/^[A-Z]$/.test(letter) && at(row, "name")) { legend[letter] = sentenceCase(at(row, "name")); return; }
    skipped.push({ row: index + 1, text: filled.join(" · ") });
  });

  return { items, skipped, legend };
}

/* ── Datos de la lista: vigencia e IVA ─────────────────────────────────────── */

const datePattern = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/;

function isoFromParts(day: number, month: number, year: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return "";
  return value.toISOString().slice(0, 10);
}

/** La fecha de vigencia: la del membrete ("VIGENTE A PARTIR DEL 02-09-2026") o la del nombre del archivo. */
export function detectValidFrom(rows: unknown[][], headerRow: number, fileName = "") {
  const top = rows.slice(0, headerRow + 1).flat();
  const texts = top.map(cellText).filter(Boolean);
  const candidates = [...texts.filter(text => /vigen/i.test(text)), ...texts, fileName];
  for (const text of candidates) {
    const match = datePattern.exec(text);
    const iso = match ? isoFromParts(Number(match[1]), Number(match[2]), Number(match[3])) : "";
    if (iso) return iso;
  }
  const dateCell = top.find(cell => cell instanceof Date && !Number.isNaN(cell.getTime())) as Date | undefined;
  return dateCell ? dateCell.toISOString().slice(0, 10) : "";
}

/** Si el membrete o el título del precio aclara el IVA. `null` si no lo dice. */
export function detectVat(rows: unknown[][], headerRow: number): boolean | null {
  const text = normalize(rows.slice(0, headerRow + 1).flat().map(cellText).join(" | "));
  if (/sin iva|s\/iva|neto de iva|mas iva|\+ ?iva/.test(text)) return false;
  if (/con iva|c\/iva|iva incluido|incluye iva/.test(text)) return true;
  return null;
}

/* ── El libro entero ───────────────────────────────────────────────────────── */

export type WorkbookSheet = { sheet: string; data: unknown[][] };

export type WorkbookAnalysis =
  | { ok: true; layout: PriceLayout; parsed: ParsedSheet; validFrom: string; pricesIncludeVat: boolean | null; source: "auto" | "saved" | "manual" }
  | { ok: false };

/**
 * Elige la hoja y las columnas. Primero manda lo que la persona marcó a mano;
 * después, la primera hoja donde se reconocen los títulos; por último, el
 * formato que quedó guardado para ese proveedor.
 */
export function analyzeWorkbook(sheets: WorkbookSheet[], options: { fileName?: string; manual?: PriceLayout | null; saved?: PriceLayout | null } = {}): WorkbookAnalysis {
  const attempts: Array<{ layout: PriceLayout; source: "auto" | "saved" | "manual" }> = [];
  if (options.manual) attempts.push({ layout: options.manual, source: "manual" });
  for (const sheet of sheets) {
    const layout = detectLayout(sheet.sheet, sheet.data);
    if (layout) attempts.push({ layout, source: "auto" });
  }
  if (options.saved) attempts.push({ layout: options.saved, source: "saved" });

  for (const { layout, source } of attempts) {
    const sheet = sheets.find(candidate => candidate.sheet === layout.sheet);
    if (!sheet || layout.columns.price === undefined || layout.columns.name === undefined) continue;
    const parsed = parseSheet(sheet.data, layout);
    if (!parsed.items.length) continue;
    return {
      ok: true, layout, parsed, source,
      validFrom: detectValidFrom(sheet.data, layout.headerRow, options.fileName),
      pricesIncludeVat: detectVat(sheet.data, layout.headerRow),
    };
  }
  return { ok: false };
}

/** Las primeras filas de cada hoja, como texto: para que la persona marque las columnas a mano. */
export function sheetPreviews(sheets: WorkbookSheet[], rows = 30, columns = 16) {
  return sheets.map(sheet => ({
    name: sheet.sheet,
    rows: sheet.data.slice(0, rows).map(row => Array.from({ length: columns }, (_, index) => cellText(row?.[index]).slice(0, 80))),
  }));
}

/* ── Comparar con la lista anterior ────────────────────────────────────────── */

type Comparable = { code?: string; name: string; presentation?: string; listPriceCents: number };

const keyOf = (item: Comparable) => `${normalize(item.code) || normalize(item.name)}|${normalize(item.presentation)}`;

export type ListComparison = {
  /** Precio que tenía cada producto nuevo en la lista anterior (o undefined si es nuevo). */
  previous: Array<number | undefined>;
  summary: { total: number; added: number; up: number; down: number; same: number; removed: number };
};

/**
 * Qué cambió respecto de la lista vigente. Un producto se reconoce por su
 * código y su presentación; si el código es único, alcanza con el código
 * (a veces el proveedor corrige cómo escribe el envase).
 */
export function compareLists(previous: Comparable[], next: Comparable[]): ListComparison {
  const byKey = new Map<string, Comparable[]>();
  const byCode = new Map<string, Comparable[]>();
  for (const item of previous) {
    byKey.set(keyOf(item), [...(byKey.get(keyOf(item)) || []), item]);
    const code = normalize(item.code);
    if (code) byCode.set(code, [...(byCode.get(code) || []), item]);
  }
  const matched = new Set<Comparable>();
  const summary = { total: next.length, added: 0, up: 0, down: 0, same: 0, removed: 0 };
  const prices = next.map(item => {
    const sameCode = byCode.get(normalize(item.code));
    // Cada producto de antes se usa una sola vez, aunque dos filas se escriban igual.
    const match = byKey.get(keyOf(item))?.find(candidate => !matched.has(candidate))
      ?? (sameCode?.length === 1 && !matched.has(sameCode[0]) ? sameCode[0] : undefined);
    if (!match) { summary.added++; return undefined; }
    matched.add(match);
    if (item.listPriceCents > match.listPriceCents) summary.up++;
    else if (item.listPriceCents < match.listPriceCents) summary.down++;
    else summary.same++;
    return match.listPriceCents;
  });
  summary.removed = previous.filter(item => !matched.has(item)).length;
  return { previous: prices, summary };
}

/* ── Búsqueda ──────────────────────────────────────────────────────────────── */

/** Todo lo que se puede buscar de un producto, en una sola línea normalizada. */
export function searchTextOf(item: Pick<ParsedPriceItem, "code" | "name" | "description" | "presentation" | "category" | "subcategory">) {
  return normalize([item.code, item.name, item.description, item.presentation, item.category, item.subcategory].filter(Boolean).join(" "));
}

/** Las palabras de una búsqueda. Tienen que aparecer todas, en cualquier orden. */
export function searchTokens(query: string) {
  return normalize(query).split(" ").filter(Boolean).slice(0, 8);
}

export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Qué tan bien coincide un producto: primero el código exacto, después el nombre. */
export function relevance(item: { code?: string; name: string }, tokens: string[]) {
  const code = normalize(item.code);
  const name = normalize(item.name);
  if (code && tokens.join(" ") === code) return 3;
  if (tokens.every(token => name.includes(token))) return name.startsWith(tokens[0] || "") ? 2 : 1.5;
  return 1;
}

/**
 * Marca la opción más barata. Se comparan entre sí los que tienen la misma
 * medida (todo lo que se vende por kilo, por un lado) y, sin medida, los que
 * se llaman igual y vienen en el mismo envase. `eligible` deja afuera a los que
 * sólo aparecieron por su descripción: buscar "techos" no tiene que premiar a
 * un mortero que "sirve para techos".
 */
export function markBest<T extends { name: string; presentation?: string; ownCents: number; measure: Measure | null }>(rows: T[], eligible: (row: T) => boolean = () => true) {
  const groupOf = (row: T) => row.measure ? `u:${row.measure.unit}` : `n:${normalize(row.name)}|${normalize(row.presentation)}`;
  const costOf = (row: T) => row.measure ? row.ownCents / row.measure.qty : row.ownCents;
  const groups = new Map<string, T[]>();
  for (const row of rows.filter(eligible)) groups.set(groupOf(row), [...(groups.get(groupOf(row)) || []), row]);
  const best = new Set<T>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    best.add(group.reduce((cheapest, row) => costOf(row) < costOf(cheapest) ? row : cheapest));
  }
  return rows.map(row => ({ ...row, best: best.has(row) }));
}
