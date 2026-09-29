/*
 * Cuentas de los bienes de uso que sirven igual en el servidor y en pantalla:
 * cuándo vence un mantenimiento programado y cuál es el próximo.
 *
 * Un mantenimiento vence en una fecha, a cierta lectura (km u horas) o lo
 * primero que llegue. Se avisa antes: 14 días antes de la fecha (lo mismo que
 * mira scripts/worker.mjs) o cuando falta el 10 % del intervalo de uso.
 */

export const ASSET_NOTICE_DAYS = 14;

export type AssetPlan = {
  _id?: unknown; title: string; dueDate?: string | Date | null; dueReading?: number | null;
  intervalMonths?: number | null; intervalReading?: number | null; notes?: string;
  status?: "pendiente" | "hecho" | "cancelado"; doneAt?: string | Date | null; doneByName?: string; createdByName?: string;
};

export type PlanState = { state: "vencido" | "proximo" | "al_dia"; daysLeft: number | null; readingLeft: number | null };

export const meterLabels: Record<string, string> = { km: "km", horas: "h" };

const DAY = 86_400_000;

/** Lo que tiene que faltar de uso para empezar a avisar. */
export function readingMargin(plan: Pick<AssetPlan, "intervalReading">, meterUnit?: string) {
  if (plan.intervalReading && plan.intervalReading > 0) return Math.round(plan.intervalReading * 0.1);
  return meterUnit === "horas" ? 25 : 1000;
}

/** Días enteros entre hoy (en Argentina) y la fecha, que se guarda a medianoche UTC. */
function daysUntil(value: string | Date, now: Date) {
  const target = new Date(value);
  const today = Date.parse(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(now));
  const day = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((day - today) / DAY);
}

export function planState(plan: AssetPlan, asset: { currentReading?: number | null; meterUnit?: string }, now = new Date()): PlanState {
  const daysLeft = plan.dueDate ? daysUntil(plan.dueDate, now) : null;
  const readingLeft = plan.dueReading != null && asset.currentReading != null && asset.meterUnit !== "ninguno"
    ? Math.round((plan.dueReading - Number(asset.currentReading || 0)) * 10) / 10 : null;
  const overdue = (daysLeft !== null && daysLeft < 0) || (readingLeft !== null && readingLeft <= 0);
  const soon = (daysLeft !== null && daysLeft <= ASSET_NOTICE_DAYS) || (readingLeft !== null && readingLeft <= readingMargin(plan, asset.meterUnit));
  return { state: overdue ? "vencido" : soon ? "proximo" : "al_dia", daysLeft, readingLeft };
}

/** El próximo pendiente: primero por fecha; los que sólo tienen lectura van después. */
export function nextPlan<T extends AssetPlan>(plans: T[] = []) {
  const pending = plans.filter(plan => (plan.status || "pendiente") === "pendiente");
  const dated = pending.filter(plan => plan.dueDate).sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
  if (dated.length) return dated[0];
  return pending.filter(plan => plan.dueReading != null).sort((a, b) => Number(a.dueReading) - Number(b.dueReading))[0] || null;
}

/** aaaa-mm-dd + N meses. Un 31 que no existe en el mes de destino cae en el último día. */
export function addMonthsIso(iso: string, months: number) {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const last = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, last))).toISOString().slice(0, 10);
}

/** "Vence en 12 días", "Venció hace 3 días", "Faltan 800 km". */
export function planStateText(state: PlanState, meterUnit?: string) {
  const parts: string[] = [];
  if (state.daysLeft !== null) parts.push(state.daysLeft < 0 ? `venció hace ${-state.daysLeft} ${-state.daysLeft === 1 ? "día" : "días"}` : state.daysLeft === 0 ? "vence hoy" : `vence en ${state.daysLeft} ${state.daysLeft === 1 ? "día" : "días"}`);
  if (state.readingLeft !== null) {
    const unit = meterLabels[meterUnit || ""] || "";
    parts.push(state.readingLeft <= 0 ? `pasado por ${new Intl.NumberFormat("es-AR").format(-state.readingLeft)} ${unit}` : `faltan ${new Intl.NumberFormat("es-AR").format(state.readingLeft)} ${unit}`);
  }
  const text = parts.join(" o ");
  return text ? text[0].toUpperCase() + text.slice(1) : "Sin fecha";
}
