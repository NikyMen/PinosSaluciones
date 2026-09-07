import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Expense, Work, Task } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { notify } from "@/lib/notifications";
import { money } from "@/lib/format";

const schema = z.object({ number: z.string().trim().min(1), period: z.string().trim().min(1), percentage: z.coerce.number().min(0).max(100), amountCents: z.coerce.number().int().min(0), includeExpenses: z.boolean().default(false), approved: z.boolean().default(false), file: z.string().optional().default("") });

export async function POST(request: Request, context: RouteContext<"/api/works/[id]/certificates">) {
  try {
    const session = await requireSession(); if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const { id } = await context.params; if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json()); if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });
    await connectDB(); const before = await Work.findById(id).lean(); if (!before) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    const [expenseTotal] = parsed.data.includeExpenses
      ? await Expense.aggregate([{ $match: { workId: before._id, status: { $ne: "anulado" } } }, { $group: { _id: null, totalCents: { $sum: "$amountCents" } } }])
      : [];
    const certificate = { ...parsed.data, expensesCents: Number(expenseTotal?.totalCents || 0), invoiced: false };
    const work = await Work.findByIdAndUpdate(id, { $push: { certificates: certificate } }, { new: true });
    if (parsed.data.approved) await notify({
      title: `Certificado ${parsed.data.number} listo para facturar`,
      body: `Obra ${work.code} — ${work.name}. Avance ${parsed.data.percentage}% · ${money(parsed.data.amountCents)}. Lo emitió ${session.name}.`,
      kind: "certificado", href: `/app/works/${work._id}`, roles: ["administracion"], dedupeKey: `certificate-${work._id}-${parsed.data.number}`,
    });
    if (parsed.data.approved) await Task.create({ title: `Facturar certificado ${parsed.data.number} — ${work.name}`, type: "facturar_certificado", status: "pendiente", assigneeRole: "administracion", relatedType: "works", relatedId: work._id });
    await audit(session, "add_certificate", "works", id, before, work.toObject());
    return Response.json(work, { status: 201 });
  } catch (error) { return apiError(error); }
}
