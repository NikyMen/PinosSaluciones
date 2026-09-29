/* Unidades de los tipos de trabajo. Sin nada de la base: lo usan también las pantallas. */

export const WORK_TYPE_UNITS = ["hora", "unidad", "m2", "ml"] as const;
export type WorkTypeUnit = (typeof WORK_TYPE_UNITS)[number];

export const unitLabels: Record<string, { per: string; short: string }> = {
  hora: { per: "por hora", short: "h" },
  unidad: { per: "por unidad", short: "u" },
  m2: { per: "por m²", short: "m²" },
  ml: { per: "por metro lineal", short: "ml" },
};

export type WorkTypeRow = { _id: string; name: string; unit: WorkTypeUnit; rateCents: number; active: boolean };

/** La unidad que se adivina por el nombre: "Mt2 - EXTERIOR" va por m², un plus por unidad. */
export function guessUnit(name: string): WorkTypeUnit {
  const text = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/\bm(t)?2\b|mt2/.test(text)) return "m2";
  if (/\bmts?\b|lineal/.test(text)) return "ml";
  if (/\bplus\b/.test(text)) return "unidad";
  return "hora";
}

/** "12 h", "1 u", "35 m²". */
export function quantityLabel(quantity: number, unit?: string) {
  return `${quantity.toLocaleString("es-AR", { maximumFractionDigits: 2 })} ${unitLabels[unit || "hora"]?.short || "h"}`;
}
