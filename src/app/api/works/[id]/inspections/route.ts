import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Work, WorkInspection } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { inspectionCreatePayload } from "@/lib/schemas";
import { inspectionTemplates, qualityChecklist, safetyChecklist, TEMPLATE_VERSION } from "@/lib/inspections";
import { baseLines, dayContextBase, previousFor, progressSummary, stockDeliveries, syncProduction } from "@/lib/inspection-service";

type Lean = Record<string, unknown>;

/** Historial de inspecciones de la obra y su avance actual. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canRead(session, "works")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const work = await Work.findById(id).select("progress progressMode progressBase advances").lean() as Lean | null;
    if (!work) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    const items = await WorkInspection.find({ workId: id })
      .select("date dayKey rubro status managerName weather rubroProgressPct workProgressPct production alerts closedAt closedByName createdByName updatedAt")
      .sort({ dayKey: -1, createdAt: -1 })
      .limit(200)
      .lean();
    return Response.json({ items, progress: await progressSummary(work) });
  } catch (error) { return apiError(error); }
}

/**
 * Abre una inspección nueva en borrador. Llega con todo lo que ya se sabe:
 * los puntos de control del rubro, el personal de los partes del día, lo que
 * Stock entregó a la obra, y el material y los colores de la inspección
 * anterior del mismo rubro.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = inspectionCreatePayload.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Elegí el día y el rubro" }, { status: 400 });
    const { date: day, rubro } = parsed.data;
    await connectDB();
    const work = await Work.findById(id).select("code name progressBase labor assignedWorkers").lean() as Lean | null;
    if (!work) return Response.json({ error: "Obra no encontrada" }, { status: 404 });

    const existing = await WorkInspection.findOne({ workId: id, rubro, dayKey: day }).select("_id status").lean() as Lean | null;
    if (existing) return Response.json({ error: `Ya hay una inspección de ${inspectionTemplates[rubro].label.toLowerCase()} para ese día.`, existingId: String(existing._id) }, { status: 409 });

    const [{ last }, deliveries, latestAny] = await Promise.all([
      previousFor(work, rubro, day),
      stockDeliveries(id, day),
      WorkInspection.findOne({ workId: id }).sort({ dayKey: -1 }).select("managerName qualityResponsibleName").lean() as Promise<Lean | null>,
    ]);
    const staff = dayContextBase(work, day);
    const lastMaterial = (last?.mainMaterial || {}) as Lean;
    const lastColors = last?.colors;

    const inspection = await WorkInspection.create({
      workId: id, date: new Date(`${day}T00:00:00.000Z`), dayKey: day, rubro, templateVersion: TEMPLATE_VERSION, status: "borrador",
      managerName: String(latestAny?.managerName || session.name),
      qualityResponsibleName: String(latestAny?.qualityResponsibleName || ""),
      staff: { source: staff.people.length ? "partes" : "manual", ...staff },
      production: syncProduction([], baseLines(work), rubro),
      quality: qualityChecklist(rubro),
      safety: safetyChecklist(),
      materialsReceived: deliveries.map(row => ({ source: "stock", ...row, condition: "ok", notes: "" })),
      mainMaterial: lastMaterial.name ? {
        stockItemId: lastMaterial.stockItemId, name: lastMaterial.name, unit: lastMaterial.unit, plannedQty: lastMaterial.plannedQty,
        // Lo que quedó ayer es con lo que se arranca hoy.
        stockStart: lastMaterial.stockEnd,
      } : {},
      colors: inspectionTemplates[rubro].colors && Array.isArray(lastColors) ? lastColors : [],
      createdById: session.userId, createdByName: session.name,
    });
    await audit(session, "create_inspection", "works", id, null, { inspectionId: inspection._id, rubro, day });
    return Response.json(inspection, { status: 201 });
  } catch (error) { return apiError(error); }
}
