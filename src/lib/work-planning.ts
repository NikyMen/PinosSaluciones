import { Types } from "mongoose";
import { z } from "zod";
import { Client, Notification, Quote, User, Work, Worker, composeWorkerName } from "./models";
import { HttpError } from "./api";
import { audit } from "./audit";
import { notify } from "./notifications";
import { date } from "./format";
import { quoteNetCents } from "./net-amounts";
import { workHolidays } from "./work-calendar";
import { businessDaysBetween, workEndForDays } from "./business-days";
import { dailyRateCents, hourlyRateCents, hoursPerDay, rateMode } from "./labor";
import type { Session } from "./auth";

/*
 * Planificar la obra (pedido F8 de Obras, 10/11/2026): cuando se aprueba la
 * cotización, a Producción le llega la obra para ponerle fechas y personal. Un
 * solo paso arma todo lo que la obra necesita para arrancar: el inicio previsto,
 * la duración en días hábiles (de ahí sale el fin), el responsable y la gente.
 * Si la cotización todavía no pasó a obra, la crea. Se puede volver a planificar.
 */

type Lean = Record<string, unknown> & { _id: Types.ObjectId };
type AssignedWorker = { workerId?: unknown; name?: string };

const id = z.string().regex(/^[a-f\d]{24}$/i, "ID inválido");
const optionalId = z.union([id, z.literal("")]).optional().transform(value => value || undefined);
const day = (message: string) => z.string({ error: message }).regex(/^\d{4}-\d{2}-\d{2}$/, message);

export const planSchema = z.object({
  quoteId: optionalId, workId: optionalId,
  // Sólo al crear la obra desde la cotización.
  code: z.string().trim().max(60).optional().default(""), name: z.string().trim().max(200).optional().default(""),
  startDate: day("Poné el inicio previsto"),
  // La duración en días hábiles o el fin previsto: con la duración, el fin se calcula.
  durationBusinessDays: z.coerce.number().int().min(1, "La duración es de al menos un día hábil").max(3650).optional(),
  endDate: z.union([day("Fecha de fin inválida"), z.literal("")]).optional().transform(value => value || undefined),
  managerId: optionalId,
  workerIds: z.array(id).max(200).default([]),
  note: z.string().trim().max(500).optional().default(""),
}).refine(data => data.quoteId || data.workId, "Falta la cotización o la obra").refine(data => data.durationBusinessDays || data.endDate, "Poné la duración en días hábiles o el fin previsto");
export type PlanInput = z.infer<typeof planSchema>;

/** Una obra está sin planificar mientras espera el inicio y le falta la fecha o la gente. */
export const unplannedWorkFilter = { status: "planificada", $or: [{ startDate: null }, { assignedWorkers: { $exists: false } }, { assignedWorkers: { $size: 0 } }] };

const iso = (value: unknown) => value ? new Date(value as Date).toISOString().slice(0, 10) : "";

/** Un código de obra libre a partir del número de la cotización: OB-1495, OB-1495 (2)… */
async function freeWorkCode(base: string) {
  for (let n = 1; n < 50; n++) {
    const code = n === 1 ? base : `${base} (${n})`;
    if (!await Work.exists({ code })) return code;
  }
  return `${base} ${Date.now()}`;
}

/**
 * La obra de una cotización aprobada: la crea con el presupuesto, el rubro, la
 * ubicación y las fotos de la cotización, que pasa a "convertida". Compras y
 * Administración reciben el aviso. La usan "Pasar a obra" y la planificación.
 */
export async function createWorkFromQuote(quoteId: string, data: { code: string; name: string; startDate?: Date }, session: Session) {
  const quote = await Quote.findById(quoteId);
  if (!quote) throw new HttpError("Cotización no encontrada", 404);
  if (await Work.exists({ quoteId: quote._id })) throw new HttpError("La cotización ya tiene una obra", 409);
  // COT-2: la aprobación es un acto deliberado de alguien.
  if (quote.status !== "aprobada") throw new HttpError("La cotización tiene que estar aprobada para convertirla en obra", 409);
  if (await Work.exists({ code: data.code })) throw new HttpError(`Ya hay una obra con el código ${data.code}`, 409);
  const work = await Work.create({ ...data, clientId: quote.clientId, quoteId: quote._id, workCategoryId: quote.workCategoryId, location: quote.location, photos: quote.photos, budgetCents: quote.amountCents, budgetNetCents: quoteNetCents(quote.toObject()), status: "planificada" });
  // COT-4 y COT-6: queda registrado quién convirtió y la cotización sale del circuito activo.
  quote.status = "convertida"; quote.workId = work._id;
  quote.history.push({ action: "convert_to_work", note: `Convertida en la obra ${work.code}`, userId: session.userId, userName: session.name });
  await quote.save();
  await audit(session, "convert_to_work", "quotes", quote._id, null, work.toObject());
  // Compras necesita saberlo para preparar materiales según la fecha de inicio.
  await notify({
    title: `Nueva obra ${work.code}: ${work.name}`,
    body: `${session.name} convirtió la cotización ${quote.number}. Inicio previsto: ${work.startDate ? date(work.startDate) : "sin fecha definida"}.`,
    kind: "obra", href: `/app/works/${work._id}`, roles: ["compras", "administracion"], dedupeKey: `work-created-${work._id}`,
  });
  return work;
}

/** Lo que muestra el panel: la cotización o la obra, la gente de los legajos con sus otras obras, los responsables posibles y los feriados. */
export async function planningData(target: { quoteId?: string; workId?: string }) {
  const work = target.workId ? await Work.findById(target.workId).select("code name status startDate endDate managerId assignedWorkers labor.workerId quoteId clientId").lean<Lean>()
    : target.quoteId ? await Work.findOne({ quoteId: target.quoteId }).select("code name status startDate endDate managerId assignedWorkers labor.workerId quoteId clientId").lean<Lean>() : null;
  const quoteId = target.quoteId || (work?.quoteId ? String(work.quoteId) : "");
  const quote = quoteId ? await Quote.findById(quoteId).select("number title status clientId amountCents").lean<Lean>() : null;
  if (!work && !quote) throw new HttpError("No se encontró la cotización ni la obra", 404);
  if (!work && quote && quote.status !== "aprobada") throw new HttpError(quote.status === "convertida" ? "La cotización ya pasó a obra" : "La cotización tiene que estar aprobada para planificar su obra", 409);
  const client = await Client.findById(work?.clientId || quote?.clientId).select("name").lean<{ name?: string }>();

  const [workers, users, holidays, others] = await Promise.all([
    Worker.find({ active: { $ne: false } }).select("name firstName lastName category dni").sort({ name: 1 }).lean<Lean[]>(),
    User.find({ active: { $ne: false } }).select("name role").sort({ name: 1 }).lean<Lean[]>(),
    workHolidays(),
    // Las otras obras vivas, para avisar si alguien ya está asignado en esas fechas.
    Work.find({ status: { $in: ["planificada", "en_curso", "pausada"] }, "assignedWorkers.0": { $exists: true }, ...(work ? { _id: { $ne: work._id } } : {}) }).select("code name startDate endDate assignedWorkers.workerId").lean<Lean[]>(),
  ]);
  const busy = new Map<string, Array<{ code: string; name: string; startDate: string; endDate: string }>>();
  for (const other of others) for (const row of (other.assignedWorkers as AssignedWorker[]) || []) {
    const key = String(row.workerId || "");
    if (key) busy.set(key, [...(busy.get(key) || []), { code: String(other.code || ""), name: String(other.name || ""), startDate: iso(other.startDate), endDate: iso(other.endDate) }]);
  }
  const withLabor = new Set(((work?.labor as Array<{ workerId?: unknown }> | undefined) || []).map(row => String(row.workerId || "")));
  const assigned = ((work?.assignedWorkers as AssignedWorker[] | undefined) || []).map(row => ({ workerId: String(row.workerId || ""), name: String(row.name || ""), hasLabor: withLabor.has(String(row.workerId || "")) }));
  const start = iso(work?.startDate), end = iso(work?.endDate);
  return {
    quote: quote ? { _id: String(quote._id), number: String(quote.number || ""), title: String(quote.title || ""), status: String(quote.status || "") } : null,
    work: work ? { _id: String(work._id), code: String(work.code || ""), name: String(work.name || ""), status: String(work.status || ""), startDate: start, endDate: end,
      durationBusinessDays: start && end ? businessDaysBetween(start, end, holidays) : 0, managerId: work.managerId ? String(work.managerId) : "", assigned } : null,
    clientName: String(client?.name || ""),
    suggestedCode: work ? "" : await freeWorkCode(`OB-${String(quote?.number || "").trim()}`),
    suggestedName: work ? "" : String(quote?.title || ""),
    workers: workers.map(worker => ({ _id: String(worker._id), name: String(worker.name || composeWorkerName(worker as Record<string, unknown>)), category: String(worker.category || ""), busy: busy.get(String(worker._id)) || [] })),
    users: users.map(user => ({ _id: String(user._id), name: String(user.name || "") })),
    holidays: [...holidays],
  };
}

/** Lo que espera planificación: las cotizaciones aprobadas que todavía no tienen obra y cuántas obras están sin fecha o sin gente. */
export async function pendingPlanning() {
  const [quotes, unplanned] = await Promise.all([
    Quote.find({ status: "aprobada" }).select("number title clientId amountCents updatedAt").sort({ updatedAt: -1 }).limit(50).lean<Lean[]>(),
    Work.countDocuments(unplannedWorkFilter),
  ]);
  const withWork = new Set((await Work.find({ quoteId: { $in: quotes.map(quote => quote._id) } }).select("quoteId").lean<Lean[]>()).map(work => String(work.quoteId)));
  const waiting = quotes.filter(quote => !withWork.has(String(quote._id)));
  const clients = await Client.find({ _id: { $in: waiting.map(quote => quote.clientId) } }).select("name").lean<Lean[]>();
  const clientName = new Map(clients.map(client => [String(client._id), String(client.name || "")]));
  return {
    quotes: waiting.map(quote => ({ _id: String(quote._id), number: String(quote.number || ""), title: String(quote.title || ""), clientName: clientName.get(String(quote.clientId)) || "" })),
    unplannedWorks: unplanned,
  };
}

/** Guarda la planificación: fechas, responsable y personal. Crea la obra si la cotización todavía no la tiene. */
export async function planWork(input: PlanInput, session: Session, ip?: string) {
  const holidays = await workHolidays();
  const start = input.startDate;
  const end = input.durationBusinessDays ? workEndForDays(start, input.durationBusinessDays, holidays) : input.endDate!;
  if (!end) throw new HttpError("No se pudo calcular el fin previsto: revisá el inicio y la duración");
  if (end < start) throw new HttpError("El fin previsto no puede ser anterior al inicio");
  if (input.managerId && !await User.exists({ _id: input.managerId, active: { $ne: false } })) throw new HttpError("El responsable elegido ya no es un usuario activo");
  const wanted = [...new Set(input.workerIds)];
  const workers = await Worker.find({ _id: { $in: wanted } }).lean<Lean[]>();
  if (workers.length !== wanted.length) throw new HttpError("Una de las personas elegidas ya no está en los legajos");

  let work = input.workId ? await Work.findById(input.workId) : input.quoteId ? await Work.findOne({ quoteId: input.quoteId }) : null;
  let created = false;
  if (!work) {
    if (!input.quoteId) throw new HttpError("Obra no encontrada", 404);
    const quote = await Quote.findById(input.quoteId).select("number title").lean<{ number?: string; title?: string }>();
    if (!quote) throw new HttpError("Cotización no encontrada", 404);
    work = await createWorkFromQuote(input.quoteId, { code: input.code || await freeWorkCode(`OB-${String(quote.number || "").trim()}`), name: input.name || String(quote.title || "Obra"), startDate: new Date(`${start}T00:00:00.000Z`) }, session);
    created = true;
  }
  if (["terminada", "cerrada", "cancelada"].includes(String(work.status))) throw new HttpError("La obra ya está terminada o cancelada: no se planifica");
  const before = work.toObject();
  const startChanged = iso(before.startDate) !== start || created;

  work.startDate = new Date(`${start}T00:00:00.000Z`);
  work.endDate = new Date(`${end}T00:00:00.000Z`);
  work.managerId = input.managerId ? new Types.ObjectId(input.managerId) : undefined;
  // El personal: entra quien falta y sale quien se sacó, salvo que ya tenga horas cargadas en la obra.
  const withLabor = new Set((work.labor as Array<{ workerId?: unknown }>).map(row => String(row.workerId || "")));
  const kept: string[] = [];
  const current = work.assignedWorkers as Array<AssignedWorker>;
  const staying = current.filter(row => {
    if (wanted.includes(String(row.workerId))) return true;
    if (withLabor.has(String(row.workerId))) { kept.push(String(row.name || "")); return true; }
    return false;
  });
  const already = new Set(staying.map(row => String(row.workerId)));
  work.assignedWorkers = staying;
  for (const worker of workers as Array<Record<string, unknown>>) {
    if (already.has(String(worker._id))) continue;
    work.assignedWorkers.push({
      workerId: worker._id, name: worker.name || composeWorkerName(worker), dni: worker.dni, phone: worker.phone,
      category: worker.category, rateMode: rateMode(worker), dailyRateCents: dailyRateCents(worker),
      hoursPerDay: hoursPerDay(worker), hourlyRateCents: hourlyRateCents(worker), assignedByName: session.name,
    });
  }
  const people = work.assignedWorkers.length;
  work.activity.push({ detail: `Planificada: del ${date(work.startDate)} al ${date(work.endDate)}, ${people} ${people === 1 ? "persona" : "personas"}${input.note ? `. ${input.note}` : ""}`, userId: session.userId, authorName: session.name });
  await work.save();
  await audit(session, "plan_work", "works", work._id, before, work.toObject(), ip);

  // El aviso de Producción ("planificar la obra") queda resuelto: ya tiene fechas y gente.
  if (work.quoteId && people > 0) {
    await Notification.updateMany({ dedupeKey: `quote-approved-${String(work.quoteId)}-produccion`, status: { $in: ["nueva", "leida", "en_gestion", "pendiente", "pospuesta"] } },
      { $set: { status: "resuelta", doneAt: new Date(), doneByName: session.name }, $unset: { remindAt: "" }, $push: { history: { action: "Resuelta", note: `La obra ${work.code} quedó planificada`, at: new Date(), userName: session.name } } });
  }
  // Compras y Administración se enteran de la fecha (o de que cambió) para preparar materiales y anticipo.
  if (startChanged) {
    await notify({
      title: `Obra ${work.code} planificada: empieza el ${date(work.startDate)}`,
      body: `${session.name} la planificó del ${date(work.startDate)} al ${date(work.endDate)}, con ${people} ${people === 1 ? "persona" : "personas"}.${input.note ? ` ${input.note}` : ""}`,
      kind: "obra", href: `/app/works/${work._id}`, roles: ["compras", "administracion"], dedupeKey: `work-planned-${work._id}-${start}`,
    });
  }
  return { work: work.toObject() as Record<string, unknown>, created, kept };
}
