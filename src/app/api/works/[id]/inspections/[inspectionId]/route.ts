import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Client, Work, WorkInspection } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { inspectionPayload } from "@/lib/schemas";
import { isRubro } from "@/lib/inspections";
import { baseLines, dayContextBase, previousFor, progressSummary, stockDeliveries, syncProduction } from "@/lib/inspection-service";

type Lean = Record<string, unknown>;
type Params = { params: Promise<{ id: string; inspectionId: string }> };

async function ids(context: Params) {
  const { id, inspectionId } = await context.params;
  return isValidObjectId(id) && isValidObjectId(inspectionId) ? { id, inspectionId } : null;
}

/**
 * La inspección con todo lo que la pantalla necesita para mostrar las cuentas
 * mientras se carga: lo producido antes de ese día, el personal de los partes,
 * lo que entregó Stock y el último control de material del rubro.
 */
export async function GET(_request: Request, context: Params) {
  try {
    const session = await requireSession();
    if (!canRead(session, "works")) throw new Error("FORBIDDEN");
    const params = await ids(context);
    if (!params) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const [work, inspection] = await Promise.all([
      Work.findById(params.id).select("code name clientId startDate endDate progress progressMode progressBase advances labor assignedWorkers").lean() as Promise<Lean | null>,
      WorkInspection.findOne({ _id: params.inspectionId, workId: params.id }).lean() as Promise<Lean | null>,
    ]);
    if (!work || !inspection) return Response.json({ error: "Inspección no encontrada" }, { status: 404 });
    const rubro = inspection.rubro;
    if (!isRubro(rubro)) return Response.json({ error: "Rubro inválido" }, { status: 400 });
    const day = String(inspection.dayKey);
    const draft = inspection.status === "borrador";
    // En borrador la producción sigue a la base actual; cerrada muestra lo que quedó.
    if (draft) inspection.production = syncProduction((inspection.production as Lean[]) || [], baseLines(work), rubro);
    const [client, previous, deliveries, progress] = await Promise.all([
      work.clientId ? Client.findById(work.clientId).select("name address").lean() as Promise<Lean | null> : null,
      previousFor(work, rubro, day),
      draft ? stockDeliveries(params.id, day) : [],
      progressSummary(work),
    ]);
    const lastMaterial = (previous.last?.mainMaterial || null) as Lean | null;
    return Response.json({
      inspection,
      work: { _id: work._id, code: work.code, name: work.name, startDate: work.startDate, endDate: work.endDate, clientName: client?.name || "", address: client?.address || "" },
      context: {
        staff: dayContextBase(work, day),
        deliveries,
        previousByLine: previous.previousByLine,
        previousMaterial: lastMaterial?.name ? {
          name: lastMaterial.name, unit: lastMaterial.unit, plannedQty: lastMaterial.plannedQty, stockEnd: lastMaterial.stockEnd,
          consumptionAccumulated: lastMaterial.consumptionAccumulated, receivedAccumulated: lastMaterial.receivedAccumulated, dayKey: previous.last?.dayKey,
        } : null,
        progress,
      },
      canEdit: canWrite(session, "works") && draft,
    });
  } catch (error) { return apiError(error); }
}

const simpleKeys = ["managerName", "weather", "qualityResponsibleName", "stage", "performance", "lowPerformanceReason", "productionConsumption", "qualityNotes",
  "materialsReceived", "shortages", "shortageNeededBy", "shortageOrderStatus", "incidents", "colors", "photos", "notes"] as const;

/** Guarda el borrador. Una inspección cerrada no se edita. */
export async function PATCH(request: Request, context: Params) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const params = await ids(context);
    if (!params) return Response.json({ error: "ID inválido" }, { status: 400 });
    const raw = await request.json() as Lean;
    const parsed = inspectionPayload.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return Response.json({ error: `Dato inválido${issue ? ` en ${issue.path.join(".")}` : ""}` }, { status: 400 });
    }
    await connectDB();
    const inspection = await WorkInspection.findOne({ _id: params.inspectionId, workId: params.id });
    if (!inspection) return Response.json({ error: "Inspección no encontrada" }, { status: 404 });
    if (inspection.status === "cerrada") return Response.json({ error: "La inspección está cerrada: ya no se puede editar." }, { status: 409 });
    const data = parsed.data as Lean;
    // Solo se tocan las claves que vinieron: zod completa con valores por defecto las que faltan.
    const present = (key: string) => Object.prototype.hasOwnProperty.call(raw, key);

    const current = inspection.toObject() as Lean;
    for (const key of simpleKeys) if (present(key)) inspection.set(key, data[key]);
    if (present("staff") && data.staff) inspection.set("staff", { ...((current.staff || {}) as Lean), ...(data.staff as Lean) });
    if (present("mainMaterial") && data.mainMaterial) inspection.set("mainMaterial", { ...((current.mainMaterial || {}) as Lean), ...(data.mainMaterial as Lean) });

    // Puntos de control: del navegador solo se toma el resultado y la observación.
    for (const key of ["quality", "safety"] as const) {
      if (!present(key) || !Array.isArray(data[key])) continue;
      const incoming = new Map((data[key] as Lean[]).map(point => [String(point.key), point]));
      inspection.set(key, ((current[key] || []) as Lean[]).map(point => {
        const update = incoming.get(String(point.key));
        return update ? { ...point, result: update.result, notes: update.notes } : point;
      }));
    }

    // Producción: de cada fila solo la cantidad de hoy. En la fila libre (sin base) también la unidad y el rótulo.
    if (present("production") && Array.isArray(data.production)) {
      const work = await Work.findById(params.id).select("progressBase").lean() as Lean | null;
      const rubro = inspection.rubro;
      const synced = isRubro(rubro) && work ? syncProduction((current.production || []) as Lean[], baseLines(work), rubro) : [];
      const incoming = data.production as Lean[];
      inspection.set("production", synced.map(row => {
        const match = row.lineId ? incoming.find(item => String(item.lineId || "") === String(row.lineId)) : incoming.find(item => !item.lineId);
        if (!match) return row;
        return row.lineId
          ? { ...row, todayQty: match.todayQty }
          : { ...row, todayQty: match.todayQty, label: String(match.label || row.label), unit: String(match.unit || row.unit) };
      }));
    }

    await inspection.save();
    return Response.json(inspection);
  } catch (error) { return apiError(error); }
}

/** Solo un borrador se puede descartar. Lo cerrado es registro de obra. */
export async function DELETE(_request: Request, context: Params) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const params = await ids(context);
    if (!params) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const inspection = await WorkInspection.findOne({ _id: params.inspectionId, workId: params.id }).lean() as Lean | null;
    if (!inspection) return Response.json({ error: "Inspección no encontrada" }, { status: 404 });
    if (inspection.status === "cerrada") return Response.json({ error: "Una inspección cerrada no se puede eliminar." }, { status: 409 });
    await WorkInspection.deleteOne({ _id: inspection._id, status: "borrador" });
    await audit(session, "delete_inspection", "works", params.id, inspection, null);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
