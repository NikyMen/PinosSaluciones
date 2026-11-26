import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { pendingPlanning, planningData, planSchema, planWork } from "@/lib/work-planning";

/**
 * Planificar la obra. Con ?quoteId= o ?workId=, lo que muestra el panel (la obra
 * o la cotización, los legajos con sus otras obras, los responsables posibles y
 * los feriados). Sin nada, lo que espera planificación: las cotizaciones
 * aprobadas que todavía no tienen obra.
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "works")) throw new Error("FORBIDDEN");
    const params = new URL(request.url).searchParams;
    const quoteId = params.get("quoteId") || "", workId = params.get("workId") || "";
    if ((quoteId && !isValidObjectId(quoteId)) || (workId && !isValidObjectId(workId))) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    if (!quoteId && !workId) return Response.json(await pendingPlanning());
    return Response.json(await planningData({ quoteId: quoteId || undefined, workId: workId || undefined }));
  } catch (error) { return apiError(error); }
}

/**
 * Guarda la planificación: inicio, duración en días hábiles (o fin), responsable
 * y personal. Si la cotización aprobada todavía no pasó a obra, la crea. Alcanza
 * con el permiso de Obras: no hace falta el de Cotizaciones.
 */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const parsed = planSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const result = await planWork(parsed.data, session, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch (error) { return apiError(error); }
}
