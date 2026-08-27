import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { Work, Worker } from "@/lib/models";
import { canRead } from "@/lib/permissions";

/** Obras y partes diarios de una persona, para liquidarla desde su legajo. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canRead(session, "workers")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

    await connectDB();
    if (!await Worker.exists({ _id: id })) return Response.json({ error: "Trabajador no encontrado" }, { status: 404 });

    const works = await Work.find({ "assignedWorkers.workerId": id })
      .select("code name status assignedWorkers labor")
      .sort({ createdAt: -1 })
      .lean();

    return Response.json({ works: works.map(work => ({
      _id: work._id,
      code: work.code,
      name: work.name,
      status: work.status,
      assigned: work.assignedWorkers.find((row: { workerId?: unknown }) => String(row.workerId) === id),
      labor: work.labor.filter((row: { workerId?: unknown }) => String(row.workerId) === id),
    })) });
  } catch (error) { return apiError(error); }
}
