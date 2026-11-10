import { HttpError } from "./api";
import { progressModeOf } from "./inspections";

/** Valida también los PATCH parciales contra las fechas ya guardadas. */
export function prepareWorkChanges(changes: Record<string, unknown>, before: Record<string, unknown> = {}) {
  const merged = { ...before, ...changes };
  for (const [start, end, label] of [
    ["startDate", "endDate", "previsto"],
    ["actualStartDate", "actualEndDate", "real"],
  ]) {
    if ((start in changes || end in changes) && merged[start] && merged[end] && new Date(String(merged[end])) < new Date(String(merged[start]))) {
      throw new HttpError(`La fecha de fin ${label} no puede ser anterior a la de inicio.`);
    }
  }
  if ("progress" in changes) {
    if (progressModeOf(before) === "inspecciones" || (Array.isArray(before.progressBase) && before.progressBase.length)) {
      throw new HttpError("El avance de esta obra se calcula desde sus inspecciones.");
    }
    changes.progressMode = "manual";
    changes.progressUpdatedAt = new Date();
  }
}
