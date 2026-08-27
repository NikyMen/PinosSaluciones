/**
 * Cuentas de mano de obra, en un solo lugar: las usa la API al guardar y la
 * pantalla de la obra al mostrar el total mientras se tipea.
 *
 * La empresa maneja el jornal (lo que se paga por dia trabajado) y de ahi sale
 * el valor hora. Si a alguien se le paga por hora directo, se carga su valor
 * hora y manda ese.
 */

export type RateMode = "jornada" | "hora";

export type WorkerRates = { rateMode?: string; dailyRateCents?: number; hoursPerDay?: number; hourlyRateCents?: number };

export const DEFAULT_HOURS_PER_DAY = 8;

export function rateMode(rates: WorkerRates): RateMode {
  return rates.rateMode === "hora" ? "hora" : "jornada";
}

export function hoursPerDay(rates: WorkerRates) {
  const value = Number(rates.hoursPerDay) || 0;
  return value > 0 && value <= 24 ? value : DEFAULT_HOURS_PER_DAY;
}

/** Valor hora: el propio si esta cargado, si no el jornal dividido por las horas del jornal. */
export function hourlyRateCents(rates: WorkerRates) {
  const own = Number(rates.hourlyRateCents) || 0;
  if (own > 0) return own;
  return Math.round((Number(rates.dailyRateCents) || 0) / hoursPerDay(rates));
}

/** Valor del jornal: el propio si esta cargado, si no el valor hora por las horas del jornal. */
export function dailyRateCents(rates: WorkerRates) {
  const own = Number(rates.dailyRateCents) || 0;
  if (own > 0) return own;
  return Math.round((Number(rates.hourlyRateCents) || 0) * hoursPerDay(rates));
}

/**
 * Un parte diario a partir de la cantidad cargada: por jornada convierte a
 * horas, por hora convierte a jornadas, y devuelve el importe calculado.
 */
export function computeLabor(input: { mode: RateMode; quantity: number; rateCents: number; hoursPerDay: number }) {
  const perDay = input.hoursPerDay > 0 ? input.hoursPerDay : DEFAULT_HOURS_PER_DAY;
  const quantity = Number(input.quantity) || 0;
  const rate = Math.max(0, Math.round(Number(input.rateCents) || 0));
  if (input.mode === "jornada") {
    return {
      days: round2(quantity), hours: round2(quantity * perDay),
      dailyRateCents: rate, hourlyRateCents: Math.round(rate / perDay),
      costCents: Math.round(quantity * rate),
    };
  }
  return {
    days: round2(quantity / perDay), hours: round2(quantity),
    dailyRateCents: Math.round(rate * perDay), hourlyRateCents: rate,
    costCents: Math.round(quantity * rate),
  };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
