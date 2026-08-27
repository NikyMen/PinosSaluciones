import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Work } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { computeLabor, dailyRateCents, hourlyRateCents, hoursPerDay, rateMode } from "@/lib/labor";

/**
 * Parte diario: cuanto trabajo una persona un dia en esta obra, por jornada o
 * por hora.
 *
 * El importe se calcula con el valor que tiene asignado en la obra y se congela
 * acá: si mañana sube el jornal, las quincenas ya liquidadas no cambian. Si
 * quien carga pisa el total a mano, se guarda ese y queda marcado como manual.
 */
const schema = z.object({
  workerId: z.string().refine(isValidObjectId, "Elegí un trabajador"),
  date: z.coerce.date(),
  mode: z.enum(["jornada", "hora"]).optional(),
  quantity: z.coerce.number().positive("La cantidad tiene que ser mayor a cero"),
  rateCents: z.coerce.number().min(0).optional(),
  costCents: z.coerce.number().min(0).optional(),
  note: z.string().trim().optional().default(""),
});

const patchSchema = schema.partial().omit({ workerId: true });

export async function POST(request: Request, context: RouteContext<"/api/works/[id]/labor">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works") && !canWrite(session, "workers")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });

    await connectDB();
    const work = await Work.findById(id);
    if (!work) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    const before = work.toObject();

    const assigned = work.assignedWorkers.find((row: { workerId?: unknown }) => String(row.workerId) === parsed.data.workerId);
    if (!assigned) return Response.json({ error: "Primero asigná el trabajador a la obra" }, { status: 409 });

    const mode = parsed.data.mode || rateMode(assigned);
    const perDay = hoursPerDay(assigned);
    const rate = parsed.data.rateCents ?? (mode === "jornada" ? dailyRateCents(assigned) : hourlyRateCents(assigned));
    if (!rate && parsed.data.costCents === undefined) {
      return Response.json({ error: mode === "jornada" ? "Cargale el valor del jornal al trabajador" : "Cargale el valor hora al trabajador" }, { status: 409 });
    }
    const computed = computeLabor({ mode, quantity: parsed.data.quantity, rateCents: rate, hoursPerDay: perDay });
    const manual = parsed.data.costCents !== undefined && Math.round(parsed.data.costCents) !== computed.costCents;

    work.labor.push({
      workerId: assigned.workerId, person: assigned.name, date: parsed.data.date, mode,
      hours: computed.hours, days: computed.days,
      dailyRateCents: computed.dailyRateCents, hourlyRateCents: computed.hourlyRateCents,
      costCents: manual ? Math.round(parsed.data.costCents as number) : computed.costCents, manualCost: manual,
      note: parsed.data.note, loadedByName: session.name,
    });
    await work.save();
    await audit(session, "add_labor", "works", id, before, work.toObject());
    return Response.json(work, { status: 201 });
  } catch (error) { return apiError(error); }
}

/** Corrige un parte ya cargado: cambia la cantidad, el valor o el importe final. */
export async function PATCH(request: Request, context: RouteContext<"/api/works/[id]/labor">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works") && !canWrite(session, "workers")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const entryId = new URL(request.url).searchParams.get("entryId") || "";
    if (!isValidObjectId(id) || !isValidObjectId(entryId)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });

    await connectDB();
    const work = await Work.findById(id);
    if (!work) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    const before = work.toObject();

    const entry = work.labor.find((row: { _id?: unknown }) => String(row._id) === entryId);
    if (!entry) return Response.json({ error: "Parte no encontrado" }, { status: 404 });

    const assigned = work.assignedWorkers.find((row: { workerId?: unknown }) => String(row.workerId) === String(entry.workerId));
    // Si el trabajador ya no esta asignado, las horas del jornal se deducen de
    // los dos valores congelados en el parte.
    const perDay = assigned ? hoursPerDay(assigned)
      : Number(entry.dailyRateCents) && Number(entry.hourlyRateCents) ? hoursPerDay({ hoursPerDay: Math.round(Number(entry.dailyRateCents) / Number(entry.hourlyRateCents)) })
      : hoursPerDay({});
    const mode = parsed.data.mode || (entry.mode === "jornada" ? "jornada" : "hora");
    const quantity = parsed.data.quantity ?? (mode === "jornada" ? Number(entry.days) || Number(entry.hours) / perDay : Number(entry.hours) || 0);
    const rate = parsed.data.rateCents ?? (mode === "jornada" ? dailyRateCents(entry) : hourlyRateCents(entry));
    const computed = computeLabor({ mode, quantity, rateCents: rate, hoursPerDay: perDay });
    const manual = parsed.data.costCents !== undefined && Math.round(parsed.data.costCents) !== computed.costCents;

    entry.set({
      mode, hours: computed.hours, days: computed.days,
      dailyRateCents: computed.dailyRateCents, hourlyRateCents: computed.hourlyRateCents,
      costCents: manual ? Math.round(parsed.data.costCents as number) : computed.costCents, manualCost: manual,
      ...(parsed.data.date ? { date: parsed.data.date } : {}),
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    });
    await work.save();
    await audit(session, "edit_labor", "works", id, before, work.toObject());
    return Response.json(work);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: RouteContext<"/api/works/[id]/labor">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works") && !canWrite(session, "workers")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const entryId = new URL(request.url).searchParams.get("entryId") || "";
    if (!isValidObjectId(id) || !isValidObjectId(entryId)) return Response.json({ error: "ID inválido" }, { status: 400 });

    await connectDB();
    const work = await Work.findById(id);
    if (!work) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    const before = work.toObject();
    work.labor = work.labor.filter((row: { _id?: unknown }) => String(row._id) !== entryId);
    await work.save();
    await audit(session, "remove_labor", "works", id, before, work.toObject());
    return Response.json(work);
  } catch (error) { return apiError(error); }
}
