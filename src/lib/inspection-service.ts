import "server-only";
import { Types } from "mongoose";
import { StockItem, Work, WorkInspection } from "./models";
import { computeWorkProgress, dayKey, isRubro, progressModeOf, rubroLabel, staffFromLabor, type InspectionRubro, type ProgressLine, type ProgressMode, type WorkProgress } from "./inspections";

export { progressModeOf };

/*
 * Lo que las inspecciones necesitan leer de otros modulos. Nada de esto se
 * vuelve a cargar a mano en la inspeccion:
 *   - personal y horas: los partes diarios de la obra;
 *   - materiales que entraron: los egresos de stock hacia la obra;
 *   - lo producido antes: las inspecciones cerradas.
 */

type Lean = Record<string, unknown>;

export function baseLines(work: Lean): ProgressLine[] {
  const lines = Array.isArray(work.progressBase) ? work.progressBase as Lean[] : [];
  return lines.filter(line => isRubro(line.rubro)).map(line => ({
    _id: String(line._id), rubro: line.rubro as InspectionRubro, label: String(line.label || rubroLabel(String(line.rubro))),
    unit: String(line.unit || ""), plannedQty: Number(line.plannedQty) || 0, initialQty: Number(line.initialQty) || 0, amountCents: Number(line.amountCents) || 0,
  }));
}

/** Producción informada por las inspecciones cerradas, sumada por línea de la base. `beforeDay` corta en ese día (sin incluirlo). */
export async function closedProductionByLine(workId: unknown, beforeDay?: string) {
  const rows = await WorkInspection.aggregate<{ _id: Types.ObjectId; qty: number }>([
    { $match: { workId: new Types.ObjectId(String(workId)), status: "cerrada", ...(beforeDay ? { dayKey: { $lt: beforeDay } } : {}) } },
    { $unwind: "$production" },
    { $match: { "production.lineId": { $ne: null } } },
    { $group: { _id: "$production.lineId", qty: { $sum: { $ifNull: ["$production.todayQty", 0] } } } },
  ]);
  return Object.fromEntries(rows.map(row => [String(row._id), Number(row.qty) || 0])) as Record<string, number>;
}

export type ProgressSummary = WorkProgress & { mode: ProgressMode; progress: number };

/**
 * Recalcula el avance fisico de la obra y lo deja guardado en `Work.progress`.
 *
 * Con base de avance manda lo que dicen las inspecciones. Sin base no se
 * inventa un porcentaje: queda "sin base". La unica excepcion es una obra que ya
 * venia con avance manual: ese numero se respeta hasta que se le arme la base.
 */
export async function recomputeWorkProgress(workId: unknown): Promise<ProgressSummary | null> {
  const work = await Work.findById(workId).select("progress progressMode progressBase advances").lean() as Lean | null;
  if (!work) return null;
  const result = computeWorkProgress(baseLines(work), await closedProductionByLine(workId));
  const current = progressModeOf(work);
  let mode: ProgressMode; let progress: number;
  if (result.overall !== null) { mode = "inspecciones"; progress = result.overall; }
  else if (current === "manual") { mode = "manual"; progress = Number(work.progress) || 0; }
  else { mode = "sin_base"; progress = 0; }
  await Work.updateOne({ _id: work._id }, { $set: { progress, progressMode: mode, progressUpdatedAt: new Date() } });
  return { ...result, mode, progress };
}

/** Resumen del avance sin escribir nada: para mostrar. */
export async function progressSummary(work: Lean): Promise<ProgressSummary> {
  const result = computeWorkProgress(baseLines(work), await closedProductionByLine(work._id));
  const mode = progressModeOf(work);
  return { ...result, mode, progress: Number(work.progress) || 0 };
}

export type StockDelivery = { stockItemId: string; movementId: string; name: string; unit: string; quantity: number };

/** Lo que Stock entregó a la obra ese día (egresos hacia la obra). */
export async function stockDeliveries(workId: unknown, day: string): Promise<StockDelivery[]> {
  const id = new Types.ObjectId(String(workId));
  const items = await StockItem.find({ "movements.workId": id }).select("name unit movements").lean() as Lean[];
  const deliveries: StockDelivery[] = [];
  for (const item of items) {
    for (const movement of (item.movements as Lean[] | undefined) || []) {
      if (movement.kind !== "egreso" || String(movement.workId) !== String(id) || dayKey(movement.date as Date) !== day) continue;
      deliveries.push({ stockItemId: String(item._id), movementId: String(movement._id), name: String(item.name), unit: String(item.unit || ""), quantity: Number(movement.quantity) || 0 });
    }
  }
  return deliveries;
}

export type ProductionRow = { lineId?: unknown; label?: string; unit?: string; plannedQty?: number; todayQty?: number | null; previousQty?: number; accumulatedQty?: number; progressPct?: number | null };

/**
 * Las filas de producción de un borrador siguen a la base de avance del rubro:
 * si se agregó una línea aparece, si se quitó se va, y si cambió la cantidad
 * prevista se actualiza. Lo que ya se había tipeado para hoy se conserva.
 * Sin base queda una sola fila libre: la producción se registra igual, pero no
 * mueve el avance.
 */
export function syncProduction(rows: Lean[], lines: ProgressLine[], rubro: InspectionRubro): ProductionRow[] {
  const today = (row?: Lean) => row?.todayQty === null || row?.todayQty === undefined ? undefined : Number(row.todayQty);
  const ofRubro = lines.filter(line => line.rubro === rubro);
  if (!ofRubro.length) {
    const free = rows.find(row => !row.lineId);
    return [{ label: String(free?.label || rubroLabel(rubro)), unit: String(free?.unit || "m2"), plannedQty: 0, todayQty: today(free) }];
  }
  return ofRubro.map(line => {
    const existing = rows.find(row => row.lineId && String(row.lineId) === line._id);
    return { lineId: new Types.ObjectId(line._id), label: line.label, unit: line.unit, plannedQty: line.plannedQty, todayQty: today(existing) };
  });
}

/** Lo previo al día de la inspección: producción por línea y el último control de material del rubro. */
export async function previousFor(work: Lean, rubro: InspectionRubro, day: string) {
  const lines = baseLines(work);
  const closed = await closedProductionByLine(work._id, day);
  const previousByLine = Object.fromEntries(lines.map(line => [line._id, (Number(line.initialQty) || 0) + (closed[line._id] || 0)]));
  const last = await WorkInspection.findOne({ workId: work._id, rubro, status: "cerrada", dayKey: { $lt: day } }).sort({ dayKey: -1 }).lean() as Lean | null;
  return { previousByLine, last };
}

export function dayContextBase(work: Lean, day: string) {
  return staffFromLabor((work.labor as Lean[] | undefined) || [], (work.assignedWorkers as Lean[] | undefined) || [], day);
}
