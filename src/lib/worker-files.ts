import type { Types } from "mongoose";
import { Worker } from "./models";
import { HttpError } from "./api";

/*
 * Legajos del personal. Cada persona tiene un número; si se da de baja y
 * después vuelve, recibe un número nuevo (el siguiente al más alto que se usó
 * alguna vez) y el período anterior queda guardado con su legajo de entonces.
 * Un número nunca se repite, ni con alguien que ya se fue.
 */

type WorkerLean = { _id: Types.ObjectId; name?: string; fileNumber?: number; active?: boolean; activeSince?: Date; createdAt?: Date; fileHistory?: Array<{ fileNumber?: number }> };

/** El legajo que sigue al más alto que se usó alguna vez. */
export async function nextFileNumber() {
  const [row] = await Worker.aggregate([
    { $project: { numbers: { $concatArrays: [{ $cond: [{ $gt: ["$fileNumber", 0] }, ["$fileNumber"], []] }, { $ifNull: ["$fileHistory.fileNumber", []] }] } } },
    { $unwind: "$numbers" },
    { $group: { _id: null, max: { $max: "$numbers" } } },
  ]);
  return Number(row?.max || 0) + 1;
}

/** Un legajo no puede ser de dos personas, ni de alguien que ya lo tuvo antes. */
export async function assertFileNumberFree(fileNumber: number, exceptId?: unknown) {
  const owner = await Worker.findOne({
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    $or: [{ fileNumber }, { "fileHistory.fileNumber": fileNumber }],
  }).select("name").lean() as WorkerLean | null;
  if (owner) throw new HttpError(`El legajo ${fileNumber} ya es (o fue) de ${owner.name || "otra persona"}`, 409);
}

/** Al dar de alta: el legajo que se cargó (si está libre) o el siguiente. */
export async function prepareNewWorker(data: Record<string, unknown>) {
  const fileNumber = Number(data.fileNumber || 0);
  if (fileNumber > 0) await assertFileNumberFree(fileNumber);
  data.fileNumber = fileNumber > 0 ? fileNumber : await nextFileNumber();
  data.activeSince = data.activeSince || new Date();
  data.active = true;
}

/** Al editar: un legajo vacío no se toca; uno cambiado tiene que estar libre. */
export async function prepareWorkerChanges(changes: Record<string, unknown>, workerId: unknown) {
  if (!("fileNumber" in changes)) return;
  const fileNumber = Number(changes.fileNumber || 0);
  if (fileNumber > 0) await assertFileNumberFree(fileNumber, workerId);
  else delete changes.fileNumber;
  // La baja y el alta van por su propio botón: se registran con fecha y motivo.
  delete changes.active;
}

/** Baja: deja de aparecer para asignar a obras y el período queda en su historial. */
export async function deactivateWorker(workerId: string, date: Date, reason: string) {
  const worker = await Worker.findById(workerId);
  if (!worker) throw new HttpError("Trabajador no encontrado", 404);
  if (worker.active === false) throw new HttpError("Ya está dado de baja", 409);
  worker.fileHistory = [...(worker.fileHistory || []), { fileNumber: worker.fileNumber, from: worker.activeSince || worker.get("createdAt"), to: date, reason }];
  worker.active = false;
  worker.leftAt = date;
  worker.leaveReason = reason;
  await worker.save();
  return worker.toObject();
}

/** Reactivar: vuelve con un legajo nuevo; el anterior queda en el historial. */
export async function reactivateWorker(workerId: string, date: Date) {
  const worker = await Worker.findById(workerId);
  if (!worker) throw new HttpError("Trabajador no encontrado", 404);
  if (worker.active !== false) throw new HttpError("Ya está activo", 409);
  worker.fileNumber = await nextFileNumber();
  worker.active = true;
  worker.activeSince = date;
  worker.leftAt = undefined;
  worker.leaveReason = undefined;
  await worker.save();
  return worker.toObject();
}
