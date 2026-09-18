import { isValidObjectId, Types } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Quote, Work, WorkInspection } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { progressBasePayload } from "@/lib/schemas";
import { computeCascade, type CascadeParams, type OverheadLine, type QuoteItem } from "@/lib/cascada";
import { guessRubro } from "@/lib/inspections";
import { progressModeOf, recomputeWorkProgress } from "@/lib/inspection-service";

type Lean = Record<string, unknown>;

/**
 * La base del avance y, como ayuda para armarla, los ítems de la cotización de
 * origen con su cantidad, su unidad y su precio al cliente (que es el peso de
 * cada línea en el avance general).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canRead(session, "works")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const work = await Work.findById(id).select("quoteId progress progressMode progressBase advances").lean() as Lean | null;
    if (!work) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    let quoteItems: Array<{ code: string; name: string; unit: string; qty: number; priceCents: number; rubro: string }> = [];
    if (work.quoteId) {
      const quote = await Quote.findById(work.quoteId).select("items overheads cascade").lean() as Lean | null;
      const items = (quote?.items as QuoteItem[] | undefined) || [];
      if (items.length) {
        const result = computeCascade({ items, overheads: (quote?.overheads as OverheadLine[] | undefined) || [], params: (quote?.cascade || {}) as Partial<CascadeParams> });
        quoteItems = result.items.map(item => ({ code: String(item.code || ""), name: item.name, unit: item.unit, qty: item.qty, priceCents: Math.round(item.priceCents), rubro: guessRubro(item.name) }));
      }
    }
    return Response.json({ lines: work.progressBase || [], quoteItems, mode: progressModeOf(work), legacyProgress: progressModeOf(work) === "manual" ? Number(work.progress) || 0 : null });
  } catch (error) { return apiError(error); }
}

/** Reemplaza la base de avance y recalcula el avance de la obra. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = progressBasePayload.safeParse(await request.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return Response.json({ error: `Revisá la base de avance${issue ? ` (${issue.path.join(".")}: ${issue.message})` : ""}` }, { status: 400 });
    }
    await connectDB();
    const before = await Work.findById(id).select("progressBase progress progressMode").lean() as Lean | null;
    if (!before) return Response.json({ error: "Obra no encontrada" }, { status: 404 });

    const previous = ((before.progressBase as Lean[] | undefined) || []);
    const lines = parsed.data.lines.map(line => ({ ...line, _id: line._id && previous.some(old => String(old._id) === line._id) ? new Types.ObjectId(line._id) : new Types.ObjectId() }));

    // Una línea que ya tiene producción en inspecciones cerradas no se borra ni cambia de rubro: se perdería avance.
    const withProduction = new Set((await WorkInspection.distinct("production.lineId", { workId: before._id, status: "cerrada" })).map(String));
    for (const old of previous) {
      const oldId = String(old._id);
      if (!withProduction.has(oldId)) continue;
      const kept = lines.find(line => String(line._id) === oldId);
      if (!kept) return Response.json({ error: `“${String(old.label)}” ya tiene producción en inspecciones cerradas: no se puede quitar.` }, { status: 409 });
      if (kept.rubro !== old.rubro) return Response.json({ error: `“${String(old.label)}” ya tiene producción en inspecciones cerradas: no se puede cambiar de rubro.` }, { status: 409 });
    }

    await Work.updateOne({ _id: before._id }, { $set: { progressBase: lines } });
    const progress = await recomputeWorkProgress(before._id);
    await audit(session, "update_progress_base", "works", id, { progressBase: previous, progress: before.progress }, { progressBase: lines, progress: progress?.progress, mode: progress?.mode });
    return Response.json({ lines, progress });
  } catch (error) { return apiError(error); }
}
