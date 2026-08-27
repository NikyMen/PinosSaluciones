import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Work, Worker } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";

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
      category: worker.category, dailyRateCents: worker.dailyRateCents, hoursPerDay: worker.hoursPerDay,
      assignedByName: session.name,
    });
    await work.save();
    await audit(session, "assign_worker", "works", id, before, work.toObject());
    return Response.json(work, { status: 201 });
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
