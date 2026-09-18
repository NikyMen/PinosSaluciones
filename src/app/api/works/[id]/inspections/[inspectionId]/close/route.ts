import { isValidObjectId, Types } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Work, WorkInspection } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { notify } from "@/lib/notifications";
import { date } from "@/lib/format";
import { closeProblems, computeWorkProgress, inspectionAlerts, isRubro, lineProgress, materialControl, rubroLabel, type AlertKind, type InspectionDraft } from "@/lib/inspections";
import { baseLines, dayContextBase, previousFor, recomputeWorkProgress, syncProduction } from "@/lib/inspection-service";
import type { Role } from "@/lib/constants";

type Lean = Record<string, unknown>;

/** A quién le llega cada tipo de alerta. Gerencia la ve siempre. */
const alertAudience: Record<AlertKind, Role[]> = {
  calidad: ["arquitecto"], seguridad: ["arquitecto"], rendimiento: ["arquitecto"], produccion: ["arquitecto"], materiales: ["compras"],
};

/**
 * Cerrar una inspección. Todo lo que pesa se calcula acá, no en el navegador:
 * la producción de días anteriores, la acumulada, el avance del rubro, el
 * control de material y las alertas. Después se recalcula el avance de la obra,
 * se deja la entrada en el historial y se avisa a quien corresponda.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string; inspectionId: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const { id, inspectionId } = await context.params;
    if (!isValidObjectId(id) || !isValidObjectId(inspectionId)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const [work, inspection] = await Promise.all([
      Work.findById(id).select("code name progress progressMode progressBase advances labor assignedWorkers").lean() as Promise<Lean | null>,
      WorkInspection.findOne({ _id: inspectionId, workId: id }).lean() as Promise<Lean | null>,
    ]);
    if (!work || !inspection) return Response.json({ error: "Inspección no encontrada" }, { status: 404 });
    if (inspection.status === "cerrada") return Response.json({ error: "La inspección ya estaba cerrada." }, { status: 409 });
    const rubro = inspection.rubro;
    if (!isRubro(rubro)) return Response.json({ error: "Rubro inválido" }, { status: 400 });
    const day = String(inspection.dayKey);

    // Una sola por obra, rubro y día. El índice ya lo impide al crear; esto cubre datos viejos o cargados por fuera.
    const duplicate = await WorkInspection.exists({ _id: { $ne: inspection._id }, workId: id, rubro, dayKey: day, status: "cerrada" });
    if (duplicate) return Response.json({ error: `Ya hay una inspección cerrada de ${rubroLabel(rubro).toLowerCase()} para el ${date(day)}.` }, { status: 409 });

    const lines = baseLines(work);
    const { previousByLine, last } = await previousFor(work, rubro, day);

    // Producción: lo de antes (producción previa de la base + inspecciones cerradas anteriores) más lo de hoy.
    const production = syncProduction((inspection.production as Lean[]) || [], lines, rubro).map(row => {
      const lineId = row.lineId ? String(row.lineId) : "";
      const previousQty = lineId ? Number(previousByLine[lineId] || 0) : 0;
      const todayQty = row.todayQty;
      const accumulatedQty = Math.round((previousQty + (Number(todayQty) || 0)) * 100) / 100;
      return { ...row, previousQty, accumulatedQty, progressPct: lineId ? lineProgress(Number(row.plannedQty), accumulatedQty) : null };
    });
    const accumulatedToDate = Object.fromEntries(production.filter(row => row.lineId).map(row => [String(row.lineId), row.accumulatedQty - (Number(lines.find(line => line._id === String(row.lineId))?.initialQty) || 0)]));
    const rubroProgressPct = computeWorkProgress(lines.filter(line => line.rubro === rubro), accumulatedToDate).byRubro[rubro] ?? null;

    // El personal sale de los partes del día. Si no hay partes, vale lo que se cargó a mano.
    const partes = dayContextBase(work, day);
    const staff = partes.people.length ? { ...((inspection.staff || {}) as Lean), source: "partes", ...partes } : { ...((inspection.staff || {}) as Lean), source: "manual" };

    // Material: se sigue la cuenta del mismo material de la inspección anterior del rubro.
    const main = (inspection.mainMaterial || {}) as Lean;
    const lastMain = (last?.mainMaterial || {}) as Lean;
    const sameMaterial = Boolean(main.name) && String(lastMain.name || "").trim().toLowerCase() === String(main.name || "").trim().toLowerCase();
    const previousConsumption = sameMaterial ? Number(lastMain.consumptionAccumulated) || 0 : 0;
    const receivedPrevious = sameMaterial ? Number(lastMain.receivedAccumulated) || 0 : 0;
    const control = main.name ? materialControl({
      plannedQty: Number(main.plannedQty) || 0, stockStart: Number(main.stockStart) || 0, receivedToday: Number(main.receivedToday) || 0,
      stockEnd: Number(main.stockEnd) || 0, previousConsumption, receivedPrevious,
    }, rubroProgressPct) : null;

    const draft = { ...inspection, rubro, production } as unknown as InspectionDraft;
    const problems = closeProblems(draft);
    if (problems.length) return Response.json({ error: "Todavía no se puede cerrar la inspección.", problems }, { status: 400 });
    const alerts = inspectionAlerts(draft, control);

    const now = new Date();
    const closed = await WorkInspection.findOneAndUpdate({ _id: inspection._id, status: "borrador" }, {
      $set: {
        status: "cerrada", production, rubroProgressPct, staff, alerts,
        // Lo que no se pudo calcular (sin avance medido, sin total previsto) queda vacío, no en null.
        mainMaterial: main.name && control ? Object.fromEntries(Object.entries({ ...main, previousConsumption, receivedPrevious, ...control }).filter(([, value]) => value !== null)) : main,
        closedAt: now, closedById: new Types.ObjectId(session.userId), closedByName: session.name,
      },
    }, { returnDocument: "after", runValidators: true });
    if (!closed) return Response.json({ error: "La inspección ya estaba cerrada." }, { status: 409 });

    const progress = await recomputeWorkProgress(id);
    await WorkInspection.updateOne({ _id: closed._id }, { $set: { workProgressPct: progress?.mode === "inspecciones" ? progress.progress : null } });

    // Entrada en el historial de la obra, con las fotos del día.
    const summary = [
      `Inspección de ${rubroLabel(rubro).toLowerCase()} del ${date(day)} cerrada por ${session.name}.`,
      production.map(row => `${row.label}: hoy ${Number(row.todayQty) || 0} ${row.unit || ""}${row.lineId ? `, acumulado ${row.accumulatedQty} de ${row.plannedQty}` : " (sin base de avance)"}`).join(" · "),
      progress?.mode === "inspecciones" ? `Avance de la obra: ${progress.progress}%.` : "La obra no tiene base de avance: el porcentaje no se movió.",
      alerts.length ? `Alertas: ${alerts.map(alert => alert.message).join(" | ")}` : "Sin alertas.",
    ].filter(Boolean).join("\n");
    const photos = ((inspection.photos as string[] | undefined) || []).slice(0, 8);
    await Work.updateOne({ _id: id }, { $push: { activity: { _id: new Types.ObjectId(), detail: summary, photos, userId: new Types.ObjectId(session.userId), authorName: session.name, createdAt: now } } });

    // Un aviso por tipo de destinatario, no uno por alerta.
    const groups = new Map<string, { roles: Role[]; messages: string[] }>();
    for (const alert of alerts) {
      const roles = alertAudience[alert.kind];
      const key = roles.join(",");
      const group = groups.get(key) || { roles, messages: [] };
      group.messages.push(alert.message);
      groups.set(key, group);
    }
    for (const [key, group] of groups) {
      await notify({
        title: `Inspección con alertas: ${String(work.code)} — ${rubroLabel(rubro)} ${date(day)}`,
        body: group.messages.join("\n"),
        kind: "obra", href: `/app/works/${id}/inspections/${closed._id}`, roles: group.roles,
        dedupeKey: `inspection-${closed._id}-${key}`,
      });
    }

    await audit(session, "close_inspection", "works", id, inspection, { inspectionId: closed._id, rubro, day, rubroProgressPct, workProgress: progress?.progress, mode: progress?.mode, alerts });
    return Response.json({ inspection: { ...closed.toObject(), workProgressPct: progress?.mode === "inspecciones" ? progress.progress : null }, progress });
  } catch (error) { return apiError(error); }
}
