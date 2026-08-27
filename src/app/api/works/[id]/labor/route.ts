import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Work } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";

/**
 * Parte diario: cuántas horas trabajó una persona un día en esta obra.
 *
 * El importe se calcula y se congela acá, con el valor hora que sale del jornal
 * asignado. Si mañana sube el jornal, las quincenas ya liquidadas no cambian.
 */
const schema = z.object({
  workerId: z.string().refine(isValidObjectId, "Elegí un trabajador"),
  date: z.coerce.date(),
  hours: z.coerce.number().positive("Las horas tienen que ser mayores a cero").max(24, "No puede haber más de 24 horas en un día"),
  note: z.string().trim().optional().default(""),
});

export async function POST(request: Request, context: RouteContext<"/api/works/[id]/labor">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
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

    const hoursPerDay = Number(assigned.hoursPerDay) || 8;
    const hourlyRateCents = Math.round(Number(assigned.dailyRateCents || 0) / hoursPerDay);
    work.labor.push({
      workerId: assigned.workerId, person: assigned.name, date: parsed.data.date, hours: parsed.data.hours,
      hourlyRateCents, costCents: Math.round(parsed.data.hours * hourlyRateCents),
      note: parsed.data.note, loadedByName: session.name,
    });
    await work.save();
    await audit(session, "add_labor", "works", id, before, work.toObject());
    return Response.json(work, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: RouteContext<"/api/works/[id]/labor">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
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
