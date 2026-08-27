import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Work, Worker } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { dailyRateCents, hourlyRateCents, hoursPerDay, rateMode } from "@/lib/labor";

/**
 * Asigna un trabajador del legajo a la obra. Se copian nombre, DNI, teléfono y
 * valor del jornal en la obra: así el parte diario no depende de que el legajo
 * siga igual, y la obra puede mostrar los datos sin otra consulta.
 */
const schema = z.object({ workerId: z.string().refine(isValidObjectId, "Trabajador inválido") });

export async function POST(request: Request, context: RouteContext<"/api/works/[id]/workers">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });

    await connectDB();
    const work = await Work.findById(id);
    if (!work) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    const before = work.toObject();

    if (work.assignedWorkers.some((row: { workerId?: unknown }) => String(row.workerId) === parsed.data.workerId)) {
      return Response.json({ error: "Ese trabajador ya está asignado a la obra" }, { status: 409 });
    }
    const worker = await Worker.findById(parsed.data.workerId).lean() as Record<string, unknown> | null;
    if (!worker) return Response.json({ error: "Trabajador no encontrado" }, { status: 404 });

    work.assignedWorkers.push({
      workerId: worker._id, name: worker.name, dni: worker.dni, phone: worker.phone,
      category: worker.category, rateMode: rateMode(worker), dailyRateCents: dailyRateCents(worker),
      hoursPerDay: hoursPerDay(worker), hourlyRateCents: hourlyRateCents(worker),
      assignedByName: session.name,
    });
    await work.save();
    await audit(session, "assign_worker", "works", id, before, work.toObject());
    return Response.json(work, { status: 201 });
  } catch (error) { return apiError(error); }
}

/**
 * Retoca los valores del trabajador en esta obra (modo de cobro, jornal, horas
 * por jornada y valor hora) sin tocar el legajo. Los partes ya cargados quedan
 * como estan: cada uno guarda el valor con el que se liquidó.
 */
const ratesSchema = z.object({
  rateMode: z.enum(["jornada", "hora"]).optional(),
  dailyRateCents: z.coerce.number().min(0).optional(),
  hoursPerDay: z.coerce.number().min(1).max(24).optional(),
  hourlyRateCents: z.coerce.number().min(0).optional(),
});

export async function PATCH(request: Request, context: RouteContext<"/api/works/[id]/workers">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const workerId = new URL(request.url).searchParams.get("workerId") || "";
    if (!isValidObjectId(id) || !isValidObjectId(workerId)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = ratesSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });

    await connectDB();
    const work = await Work.findById(id);
    if (!work) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    const before = work.toObject();

    const assigned = work.assignedWorkers.find((row: { workerId?: unknown }) => String(row.workerId) === workerId);
    if (!assigned) return Response.json({ error: "Ese trabajador no está asignado a la obra" }, { status: 404 });

    // El jornal y el valor hora se mantienen coherentes solos: manda el modo de
    // cobro y el otro valor sale de dividir o multiplicar por las horas del jornal.
    const perDay = parsed.data.hoursPerDay ?? hoursPerDay(assigned);
    const mode = parsed.data.rateMode ?? rateMode(assigned);
    const daily = parsed.data.dailyRateCents ?? (parsed.data.hourlyRateCents !== undefined ? parsed.data.hourlyRateCents * perDay : Number(assigned.dailyRateCents) || 0);
    const hourly = parsed.data.hourlyRateCents ?? (parsed.data.dailyRateCents !== undefined ? parsed.data.dailyRateCents / perDay : Number(assigned.hourlyRateCents) || 0);
    assigned.set({
      rateMode: mode, hoursPerDay: perDay,
      dailyRateCents: Math.round(mode === "jornada" ? daily : hourly * perDay),
      hourlyRateCents: Math.round(mode === "jornada" ? daily / perDay : hourly),
    });
    await work.save();
    await audit(session, "edit_worker_rates", "works", id, before, work.toObject());
    return Response.json(work);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: RouteContext<"/api/works/[id]/workers">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const workerId = new URL(request.url).searchParams.get("workerId") || "";
    if (!isValidObjectId(id) || !isValidObjectId(workerId)) return Response.json({ error: "ID inválido" }, { status: 400 });

    await connectDB();
    const work = await Work.findById(id);
    if (!work) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    const before = work.toObject();

    // Las horas ya cargadas no se borran: son la base de la liquidación.
    if (work.labor.some((row: { workerId?: unknown }) => String(row.workerId) === workerId)) {
      return Response.json({ error: "No se puede desasignar: el trabajador ya tiene horas cargadas en esta obra" }, { status: 409 });
    }
    work.assignedWorkers = work.assignedWorkers.filter((row: { workerId?: unknown }) => String(row.workerId) !== workerId);
    await work.save();
    await audit(session, "unassign_worker", "works", id, before, work.toObject());
    return Response.json(work);
  } catch (error) { return apiError(error); }
}
