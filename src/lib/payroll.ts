import type { Types } from "mongoose";
import { Work, Worker, composeWorkerName } from "./models";
import { excludedFromTotals } from "./trash";

/*
 * La liquidación de la quincena de toda la empresa: los partes diarios de todas
 * las obras entre dos fechas, por persona, con el detalle por día, obra y tipo
 * de trabajo. Es lo mismo que la planilla de la quincena, armado desde el sistema.
 */

type Lean = Record<string, unknown> & { _id: Types.ObjectId };
type LaborLean = { _id?: Types.ObjectId; workerId?: Types.ObjectId; person?: string; date?: Date; mode?: string; hours?: number; days?: number; hourlyRateCents?: number; dailyRateCents?: number; costCents?: number; workType?: string; unit?: string; note?: string };

export type PayrollLine = { date: string; workId: string; workCode: string; workName: string; workType: string; unit: string; quantity: number; rateCents: number; costCents: number; note: string };
export type PayrollRow = {
  workerId: string; fileNumber: number | null; name: string; lastName: string; firstName: string; dni: string; position: string;
  byType: Array<{ workType: string; unit: string; quantity: number; costCents: number }>;
  hours: number; totalCents: number; lines: PayrollLine[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** El legajo que tenía la persona ese día: el de su período de entonces o el actual. */
function fileNumberAt(worker: Lean | undefined, day: Date) {
  if (!worker) return null;
  const history = (worker.fileHistory || []) as Array<{ fileNumber?: number; from?: Date; to?: Date }>;
  const past = history.find(period => period.fileNumber && (!period.from || new Date(period.from) <= day) && period.to && day <= new Date(period.to));
  return past?.fileNumber ?? (Number(worker.fileNumber) || null);
}

export async function payroll(from: Date, to: Date) {
  const excluded = await excludedFromTotals();
  const works = await Work.find({ _id: { $nin: excluded.works }, labor: { $elemMatch: { date: { $gte: from, $lte: to } } } })
    .select("code name labor").lean() as Array<Lean & { labor?: LaborLean[] }>;
  const entries = works.flatMap(work => (work.labor || [])
    .filter(entry => entry.date && new Date(entry.date) >= from && new Date(entry.date) <= to)
    .map(entry => ({ work, entry })));
  const workerIds = [...new Set(entries.map(({ entry }) => String(entry.workerId || "")).filter(Boolean))];
  const workers = await Worker.find({ _id: { $in: workerIds } }).select("fileNumber fileHistory name firstName lastName dni position category").lean() as Lean[];
  const workerById = new Map(workers.map(worker => [String(worker._id), worker]));

  const rows = new Map<string, PayrollRow>();
  for (const { work, entry } of entries) {
    const key = String(entry.workerId || entry.person || "");
    const worker = workerById.get(String(entry.workerId || ""));
    const day = new Date(entry.date as Date);
    const row = rows.get(key) || {
      workerId: key, fileNumber: fileNumberAt(worker, day),
      name: String(worker?.name || (worker && composeWorkerName({ lastName: worker.lastName, firstName: worker.firstName })) || entry.person || "Sin nombre"), lastName: String(worker?.lastName || entry.person || ""), firstName: String(worker?.firstName || ""),
      dni: String(worker?.dni || ""), position: String(worker?.position || ""), byType: [], hours: 0, totalCents: 0, lines: [],
    };
    const byJournal = entry.mode === "jornada" && !entry.workType;
    const workType = entry.workType || (byJournal ? "Jornal" : "Por hora");
    const unit = entry.unit || (byJournal ? "jornada" : "hora");
    const quantity = byJournal ? Number(entry.days) || 0 : Number(entry.hours) || 0;
    const rateCents = byJournal ? Number(entry.dailyRateCents) || 0 : Number(entry.hourlyRateCents) || 0;
    const costCents = Number(entry.costCents) || 0;
    row.lines.push({ date: day.toISOString(), workId: String(work._id), workCode: String(work.code || ""), workName: String(work.name || ""), workType, unit, quantity, rateCents, costCents, note: String(entry.note || "") });
    const bucket = row.byType.find(item => item.workType === workType);
    if (bucket) { bucket.quantity = round2(bucket.quantity + quantity); bucket.costCents += costCents; }
    else row.byType.push({ workType, unit, quantity: round2(quantity), costCents });
    if (unit === "hora") row.hours = round2(row.hours + quantity);
    else if (unit === "jornada") row.hours = round2(row.hours + (Number(entry.hours) || 0));
    row.totalCents += costCents;
    rows.set(key, row);
  }

  const list = [...rows.values()]
    .map(row => ({ ...row, lines: row.lines.sort((a, b) => a.date.localeCompare(b.date) || a.workType.localeCompare(b.workType)), byType: row.byType.sort((a, b) => b.costCents - a.costCents) }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  return {
    rows: list,
    totals: { people: list.length, hours: round2(list.reduce((total, row) => total + row.hours, 0)), cents: list.reduce((total, row) => total + row.totalCents, 0), lines: entries.length, works: works.length },
  };
}
