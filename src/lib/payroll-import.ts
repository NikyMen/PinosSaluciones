import type { Types } from "mongoose";
import { Client, Work, WorkType, Worker, composeWorkerName } from "./models";
import { HttpError } from "./api";
import { guessUnit } from "./work-type-labels";
import type { Session } from "./auth";

/*
 * Importar la planilla de la quincena (como el "Libro3" de administración):
 * una fila por persona, día, tipo de trabajo y obra, con las horas y el total;
 * al costado, la tabla de tarifas por tipo de trabajo. Se carga en dos pasos:
 * la vista previa cuenta qué va a pasar y pide unir cada obra de la planilla
 * con una obra del sistema (o crearla); la confirmación lo guarda.
 * Volver a subir la misma planilla no duplica nada: cada fila lleva su marca.
 */

type Cell = unknown;
export type Sheet = { sheet: string; data: Cell[][] };
type Id = Types.ObjectId;
type WorkLean = { _id: Id; code?: string; name?: string };
type WorkerLean = { _id: Id; name?: string; firstName?: string; lastName?: string; fileNumber?: number; fileHistory?: Array<{ fileNumber?: number }>; position?: string; workType?: string; active?: boolean; dni?: string; phone?: string; category?: string };

export type PayrollRowInput = { line: number; fileNumber: number | null; fullName: string; position: string; date: Date; workType: string; quantity: number; site: string; totalCents: number };
export type ParsedPayroll = { sheet: string; rows: PayrollRowInput[]; rates: Array<{ name: string; rateCents: number }>; skipped: Array<{ line: number; reason: string }> };

export const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const compact = (value: unknown) => normalize(value).replace(/[^a-z0-9]/g, "");

/** Excel guarda las fechas como fecha, como texto dd/mm/aaaa o como número de serie. */
function toDate(value: Cell): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  if (typeof value === "number" && value > 20000 && value < 80000) return new Date(Math.round((value - 25569) * 86400000));
  const match = String(value ?? "").trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!match) return null;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
}

function toNumber(value: Cell) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").replace(/[$\s]/g, "");
  if (!text) return NaN;
  // "1.234,50" o "1234.5"
  return Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text);
}

const COLUMNS = {
  fileNumber: ["legajo", "nlegajo", "nrolegajo", "numerolegajo"],
  fullName: ["apellidoynombre", "apellidoynombres", "nombreyapellido", "nombre", "apellido"],
  position: ["categoria", "puesto"],
  date: ["dia", "fecha"],
  workType: ["ttrabajo", "tipodetrabajo", "tipotrabajo", "trabajo"],
  quantity: ["horas", "cantidad"],
  site: ["obra"],
  total: ["total15na", "total", "importe", "total15na$"],
} as const;

/** Lee la planilla: la hoja con los encabezados "Legajo, Apellido y Nombre, Día, Horas, Obra…" y la tabla de tarifas. */
export function parsePayrollWorkbook(sheets: Sheet[]): ParsedPayroll {
  for (const { sheet, data } of sheets) {
    const headerIndex = data.slice(0, 15).findIndex(row => {
      const cells = row.map(compact);
      return cells.some(cell => cell.includes("legajo")) && cells.some(cell => cell.startsWith("apellido")) && cells.includes("horas");
    });
    if (headerIndex < 0) continue;
    const header = data[headerIndex].map(compact);
    const find = (names: readonly string[]) => header.findIndex(cell => names.some(name => cell === name || cell.startsWith(name)));
    const column = {
      fileNumber: header.findIndex(cell => cell.includes("legajo")),
      fullName: find(COLUMNS.fullName), position: find(COLUMNS.position), date: find(COLUMNS.date),
      workType: find(COLUMNS.workType), quantity: find(COLUMNS.quantity), site: find(COLUMNS.site), total: header.findIndex(cell => cell.startsWith("total")),
    };
    if ([column.fullName, column.date, column.workType, column.quantity, column.site].some(index => index < 0)) {
      throw new HttpError("La planilla tiene que tener las columnas Nº Legajo, Apellido y Nombre, Día, T. Trabajo, Horas y Obra");
    }

    // La tabla de tarifas: "CATEGORIA | HORA" y abajo cada tipo con su valor.
    const rates: ParsedPayroll["rates"] = [];
    for (let r = 0; r < data.length; r++) {
      const c = data[r].findIndex((cell, index) => index > column.total && compact(cell) === "categoria" && compact(data[r][index + 1]).startsWith("hora"));
      if (c < 0) continue;
      for (let k = r + 1; k < data.length; k++) {
        const name = String(data[k][c] ?? "").trim();
        const value = toNumber(data[k][c + 1]);
        if (!name) break;
        if (Number.isFinite(value)) rates.push({ name, rateCents: Math.round(value * 100) });
      }
      break;
    }

    const rows: PayrollRowInput[] = []; const skipped: ParsedPayroll["skipped"] = [];
    for (let r = headerIndex + 1; r < data.length; r++) {
      const row = data[r];
      const fullName = String(row[column.fullName] ?? "").trim();
      if (!fullName || normalize(fullName) === "total") continue;
      const date = toDate(row[column.date]);
      const quantity = toNumber(row[column.quantity]);
      const workType = String(row[column.workType] ?? "").trim();
      const site = String(row[column.site] ?? "").trim();
      if (!date || !Number.isFinite(quantity) || !workType || !site) { skipped.push({ line: r + 1, reason: !date ? "sin día" : !workType ? "sin tipo de trabajo" : !site ? "sin obra" : "sin horas" }); continue; }
      const fileNumber = column.fileNumber >= 0 ? toNumber(row[column.fileNumber]) : NaN;
      const total = column.total >= 0 ? toNumber(row[column.total]) : NaN;
      const rate = rates.find(item => normalize(item.name) === normalize(workType));
      rows.push({
        line: r + 1, fileNumber: Number.isFinite(fileNumber) && fileNumber > 0 ? Math.round(fileNumber) : null, fullName,
        position: column.position >= 0 ? String(row[column.position] ?? "").trim() : "", date, workType, quantity, site,
        totalCents: Number.isFinite(total) ? Math.round(total * 100) : Math.round(quantity * (rate?.rateCents || 0)),
      });
    }
    if (!rows.length) throw new HttpError("La planilla no tiene filas para cargar");
    return { sheet, rows, rates, skipped };
  }
  throw new HttpError("No encontré la planilla de la quincena: tiene que tener las columnas Nº Legajo, Apellido y Nombre, Día, T. Trabajo, Horas y Obra");
}

/** "ACUÑA NAHUEL TOMAS" contra "ACUÑA, NAHUEL TOMAS": se comparan sin comas, tildes ni mayúsculas. */
const nameKey = (value: string) => compact(value);
const workerKeys = (worker: WorkerLean) => [nameKey(`${worker.lastName || ""} ${worker.firstName || ""}`), nameKey(String(worker.name || ""))];

/** Cada obra de la planilla con la obra del sistema que le corresponde, si hay una clara. */
function suggestWork(site: string, works: WorkLean[]) {
  const key = compact(site);
  const code = compact(site.split(/\s+/)[0]);
  return works.find(work => compact(work.code) === key || compact(work.name) === key)
    || works.find(work => code.length >= 3 && /\d/.test(code) && (compact(work.code) === code || compact(work.name).startsWith(code)))
    || null;
}

function occurrenceKeys(rows: PayrollRowInput[]) {
  const seen = new Map<string, number>();
  return rows.map(row => {
    const base = [row.fileNumber || nameKey(row.fullName), row.date.toISOString().slice(0, 10), compact(row.workType), row.quantity, compact(row.site)].join("|");
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return `planilla|${base}|${count}`;
  });
}

async function context(parsed: ParsedPayroll) {
  const [works, workers, types] = await Promise.all([
    Work.find().select("code name").lean() as Promise<WorkLean[]>,
    Worker.find().select("name firstName lastName fileNumber fileHistory position workType active dni phone category").lean() as Promise<WorkerLean[]>,
    WorkType.find().lean() as Promise<Array<{ _id: Id; name: string; rateCents?: number }>>,
  ]);
  // Por legajo, por nombre exacto o, si no, por nombre incompleto ("IBARRA DANIEL" es "IBARRA, DANIEL OSCAR")
  // siempre que haya una sola persona posible: con dos candidatos no se adivina.
  const findWorker = (row: PayrollRowInput) => {
    const byNumber = row.fileNumber ? workers.find(worker => worker.fileNumber === row.fileNumber) : undefined;
    if (byNumber) return byNumber;
    const key = nameKey(row.fullName);
    const exact = workers.find(worker => workerKeys(worker).includes(key));
    if (exact) return exact;
    const partial = workers.filter(worker => workerKeys(worker).some(candidate => candidate && key.length >= 8 && (candidate.startsWith(key) || key.startsWith(candidate))));
    return partial.length === 1 ? partial[0] : undefined;
  };
  return { works, workers, types, findWorker, keys: occurrenceKeys(parsed.rows) };
}

/** Qué va a pasar si se confirma: personas, tarifas, obras a unir y lo que ya estaba cargado. */
export async function previewPayroll(parsed: ParsedPayroll) {
  const { works, types, findWorker, keys } = await context(parsed);
  const existingKeys = new Set((await Work.find({ "labor.importKey": { $in: keys } }).select("labor.importKey").lean() as Array<{ labor?: Array<{ importKey?: string }> }>)
    .flatMap(work => (work.labor || []).map(entry => entry.importKey || "")));
  const people = new Map<string, { fullName: string; fileNumber: number | null; matched: string | null }>();
  for (const row of parsed.rows) {
    const key = row.fileNumber ? `l${row.fileNumber}` : nameKey(row.fullName);
    if (!people.has(key)) { const worker = findWorker(row); people.set(key, { fullName: row.fullName, fileNumber: row.fileNumber, matched: worker ? String(worker.name || "") : null }); }
  }
  const sites = new Map<string, { site: string; rows: number; totalCents: number }>();
  for (const row of parsed.rows) {
    const site = sites.get(compact(row.site)) || { site: row.site, rows: 0, totalCents: 0 };
    site.rows += 1; site.totalCents += row.totalCents;
    sites.set(compact(row.site), site);
  }
  const dates = parsed.rows.map(row => row.date.getTime());
  return {
    sheet: parsed.sheet, rows: parsed.rows.length, skipped: parsed.skipped,
    from: new Date(Math.min(...dates)).toISOString(), to: new Date(Math.max(...dates)).toISOString(),
    totalCents: parsed.rows.reduce((total, row) => total + row.totalCents, 0),
    alreadyLoaded: keys.filter(key => existingKeys.has(key)).length,
    people: { total: people.size, matched: [...people.values()].filter(person => person.matched).length, toCreate: [...people.values()].filter(person => !person.matched).map(person => person.fullName) },
    rates: parsed.rates.map(rate => {
      const current = types.find(type => normalize(type.name) === normalize(rate.name));
      return { name: rate.name, rateCents: rate.rateCents, currentCents: current ? Number(current.rateCents || 0) : null };
    }),
    sites: [...sites.values()].map(site => {
      const match = suggestWork(site.site, works);
      return { ...site, workId: match ? String(match._id) : "", workLabel: match ? [match.code, match.name].filter(Boolean).join(" · ") : "" };
    }).sort((a, b) => b.rows - a.rows),
    works: works.map(work => ({ value: String(work._id), label: [work.code, work.name].filter(Boolean).join(" · ") })),
  };
}

/** El cliente de las obras que se crean desde la planilla, hasta que se les ponga el suyo. */
async function placeholderClient() {
  const name = "A definir (obras de la planilla de quincena)";
  const existing = await Client.findOne({ name }).select("_id").lean() as { _id: Id } | null;
  if (existing) return existing._id;
  return (await Client.create({ name, active: false, notes: "Creado al importar la planilla de la quincena. Cambiale a cada obra su cliente real." }))._id as Id;
}

/** Un código de obra libre a partir del nombre de la planilla. */
async function freeCode(site: string) {
  const base = site.trim().toUpperCase().slice(0, 40);
  for (let n = 1; n < 100; n++) {
    const code = n === 1 ? base : `${base} (${n})`;
    if (!await Work.exists({ code })) return code;
  }
  return `${base} ${Date.now()}`;
}

/**
 * Guarda la planilla: actualiza las tarifas, completa legajos y puestos, da de
 * alta a quien falte, crea las obras que se eligió crear, asigna a cada persona
 * a sus obras y carga los partes. `sites` dice, para cada obra de la planilla,
 * el id de la obra del sistema o "new" para crearla.
 */
export async function importPayroll(parsed: ParsedPayroll, sites: Record<string, string>, session: Session) {
  const ctx = await context(parsed);
  // Antes de tocar nada: cada obra de la planilla tiene que tener a dónde ir.
  for (const site of new Set(parsed.rows.map(row => row.site))) {
    const choice = sites[site] || "";
    if (!choice) throw new HttpError(`Elegí a qué obra va "${site}" (o que se cree una nueva)`);
    if (choice !== "new" && !ctx.works.some(work => String(work._id) === choice)) throw new HttpError(`La obra elegida para "${site}" no existe`);
  }
  const summary = { entries: 0, skipped: 0, workersCreated: 0, fileNumbersSet: 0, worksCreated: 0, ratesUpdated: 0, totalCents: 0, conflicts: [] as string[] };
  const period = parsed.rows.reduce((min, row) => row.date < min ? row.date : min, parsed.rows[0].date);

  // 1. Tarifas.
  const typeByName = new Map(ctx.types.map(type => [normalize(type.name), type]));
  for (const rate of parsed.rates) {
    const current = await WorkType.findOne({ _id: typeByName.get(normalize(rate.name))?._id });
    if (!current) {
      const created = await WorkType.create({ name: rate.name, unit: guessUnit(rate.name), rateCents: rate.rateCents, history: [{ rateCents: rate.rateCents, from: period, userName: session.name }] });
      typeByName.set(normalize(rate.name), created.toObject()); summary.ratesUpdated++;
    } else if (current.rateCents !== rate.rateCents) {
      current.history.push({ rateCents: rate.rateCents, from: period, userName: session.name });
      current.rateCents = rate.rateCents; await current.save(); summary.ratesUpdated++;
    }
  }
  // Un tipo de trabajo que aparece en las filas pero no en la tabla también se crea.
  for (const name of new Set(parsed.rows.map(row => row.workType))) {
    if (typeByName.has(normalize(name))) continue;
    const created = await WorkType.create({ name, unit: guessUnit(name), rateCents: 0 });
    typeByName.set(normalize(name), created.toObject());
  }

  // 2. Personas: completa legajo, puesto y tipo habitual; da de alta a quien falte.
  // Los legajos de la planilla son los oficiales: si alguien tiene otro (el que
  // se le puso solo al darlo de alta), se le corrige al de la planilla. Primero
  // se liberan los que se van a reemplazar, así el orden de las filas no importa.
  const byPerson = new Map<string, PayrollRowInput[]>();
  for (const row of parsed.rows) { const key = row.fileNumber ? `l${row.fileNumber}` : nameKey(row.fullName); byPerson.set(key, [...(byPerson.get(key) || []), row]); }
  const people = [...byPerson].map(([key, rows]) => ({ key, rows, first: rows[0], worker: ctx.findWorker(rows[0]) }));
  const renumbered = new Set(people.filter(person => person.worker && person.first.fileNumber && person.worker.fileNumber !== person.first.fileNumber).map(person => String(person.worker!._id)));
  const usedNumbers = new Set(ctx.workers.flatMap(worker => [renumbered.has(String(worker._id)) ? undefined : worker.fileNumber, ...(worker.fileHistory || []).map(period => period.fileNumber)]).filter(Boolean) as number[]);
  const wanted = new Set(people.map(person => person.first.fileNumber).filter(Boolean) as number[]);
  const nextFree = () => { let number = Math.max(0, ...usedNumbers, ...wanted) + 1; while (usedNumbers.has(number)) number++; return number; };
  // Primero los que reciben su número de la planilla; después, quien no pudo.
  const free = (person: (typeof people)[number]) => Number(Boolean(person.first.fileNumber && !usedNumbers.has(person.first.fileNumber)));
  people.sort((a, b) => free(b) - free(a));

  const workerFor = new Map<string, WorkerLean>();
  for (const { key, rows, first, worker: found } of people) {
    const counts = new Map<string, number>();
    for (const row of rows) if (!/plus/i.test(row.workType)) counts.set(row.workType, (counts.get(row.workType) || 0) + row.quantity);
    const habitual = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || first.workType;
    const desired = first.fileNumber && !usedNumbers.has(first.fileNumber) ? first.fileNumber : null;
    let worker = found;
    if (!worker) {
      const [lastName, ...rest] = first.fullName.trim().split(/\s+/);
      if (first.fileNumber && !desired) summary.conflicts.push(`El legajo ${first.fileNumber} de ${first.fullName} ya es de otra persona: se le dio otro número`);
      const number = desired ?? nextFree();
      usedNumbers.add(number);
      const created = await Worker.create({ lastName, firstName: rest.join(" ") || "-", name: composeWorkerName({ lastName, firstName: rest.join(" ") || "-" }), fileNumber: number, activeSince: period, position: first.position, workType: habitual, rateMode: "hora", active: true });
      worker = created.toObject() as WorkerLean; summary.workersCreated++;
      ctx.workers.push(worker);
    } else {
      const set: Record<string, unknown> = {};
      if (first.fileNumber && worker.fileNumber !== first.fileNumber) {
        if (desired) { set.fileNumber = desired; usedNumbers.add(desired); summary.fileNumbersSet++; }
        else {
          // No se pudo: conserva el que tenía si sigue libre, o recibe uno nuevo.
          const keep = worker.fileNumber && !usedNumbers.has(worker.fileNumber) ? worker.fileNumber : nextFree();
          usedNumbers.add(keep);
          if (keep !== worker.fileNumber) set.fileNumber = keep;
          summary.conflicts.push(`El legajo ${first.fileNumber} de ${first.fullName} ya es de otra persona: queda con el ${keep}`);
        }
      }
      if (!worker.position && first.position) set.position = first.position;
      if (!worker.workType) set.workType = habitual;
      if (Object.keys(set).length) { await Worker.updateOne({ _id: worker._id }, { $set: set }); Object.assign(worker, set); }
    }
    workerFor.set(key, worker);
  }

  // 3. Obras: la elegida, o una nueva con un cliente "a definir".
  const workIdFor = new Map<string, string>();
  let clientId: Id | null = null;
  for (const site of new Set(parsed.rows.map(row => row.site))) {
    const choice = sites[site];
    if (choice !== "new") { workIdFor.set(compact(site), choice); continue; }
    clientId = clientId || await placeholderClient();
    const created = await Work.create({ code: await freeCode(site), name: site, clientId, status: "en_curso", budgetCents: 0 });
    workIdFor.set(compact(site), String(created._id)); summary.worksCreated++;
  }

  // 4. Partes diarios, obra por obra: asigna a quien no esté y no repite filas ya cargadas.
  const byWork = new Map<string, Array<{ row: PayrollRowInput; key: string }>>();
  parsed.rows.forEach((row, index) => { const workId = workIdFor.get(compact(row.site))!; byWork.set(workId, [...(byWork.get(workId) || []), { row, key: ctx.keys[index] }]); });
  for (const [workId, items] of byWork) {
    const work = await Work.findById(workId);
    if (!work) continue;
    const loaded = new Set((work.labor || []).map((entry: { importKey?: string }) => entry.importKey).filter(Boolean));
    for (const { row, key } of items) {
      if (loaded.has(key)) { summary.skipped++; continue; }
      const worker = workerFor.get(row.fileNumber ? `l${row.fileNumber}` : nameKey(row.fullName))!;
      if (!work.assignedWorkers.some((assigned: { workerId?: unknown }) => String(assigned.workerId) === String(worker._id))) {
        work.assignedWorkers.push({ workerId: worker._id, name: worker.name, dni: worker.dni, phone: worker.phone, category: worker.category, rateMode: "hora", assignedByName: session.name });
      }
      const type = typeByName.get(normalize(row.workType));
      const rate = row.quantity ? Math.round(row.totalCents / row.quantity) : Number(type?.rateCents || 0);
      work.labor.push({
        workerId: worker._id, person: worker.name, date: row.date, mode: "hora",
        hours: row.quantity, days: Math.round((row.quantity / 8) * 100) / 100, hourlyRateCents: rate, dailyRateCents: rate * 8,
        costCents: row.totalCents, manualCost: Boolean(type?.rateCents) && Math.abs(Math.round(row.quantity * Number(type?.rateCents)) - row.totalCents) > 1,
        workTypeId: type?._id, workType: row.workType, unit: guessUnit(row.workType), importKey: key,
        note: "Planilla de la quincena", loadedByName: session.name,
      });
      loaded.add(key); summary.entries++; summary.totalCents += row.totalCents;
    }
    await work.save();
  }
  return summary;
}
