import { isValidObjectId, Types } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Expense, Work, Task } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { notify } from "@/lib/notifications";
import { money } from "@/lib/format";
import { resolveWorkNetBudget } from "@/lib/work-budget";

const schema = z.object({ number: z.string().trim().min(1), period: z.string().trim().min(1), percentage: z.coerce.number().min(0).max(100), amountCents: z.coerce.number().int().min(0).optional(), includeExpenses: z.boolean().default(false), approved: z.boolean().default(false), file: z.string().optional().default(""),
  files: z.array(z.object({ path: z.string().regex(/^\/api\/uploads\/[\w.-]+$/), name: z.string().trim().max(200).optional().default("") })).max(20).optional().default([]) });

export async function POST(request: Request, context: RouteContext<"/api/works/[id]/certificates">) {
  try {
    const session = await requireSession(); if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const { id } = await context.params; if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json()); if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });
    await connectDB(); const before = await Work.findById(id).lean(); if (!before) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    const [expenseTotal] = parsed.data.includeExpenses
      ? await Expense.aggregate([{ $match: { workId: before._id, status: { $ne: "anulado" } } }, { $group: { _id: null, totalCents: { $sum: "$amountCents" } } }])
      : [];
    // Lo certificado no pasa del 100 % de la obra: antes lo controlaba sólo la pantalla.
    const certificates = (before.certificates || []) as Array<{ number?: string; percentage?: number }>;
    const used = certificates.reduce((total, item) => total + Number(item.percentage || 0), 0);
    if (used + parsed.data.percentage > 100 + 1e-6) return Response.json({ error: `Ya hay certificado un ${Math.round(used * 100) / 100}%: como mucho queda el ${Math.max(0, Math.round((100 - used) * 100) / 100)}%` }, { status: 409 });
    if (certificates.some(item => String(item.number) === parsed.data.number)) return Response.json({ error: `La obra ya tiene el certificado ${parsed.data.number}` }, { status: 409 });
    const expensesCents = Number(expenseTotal?.totalCents || 0);
    // El importe es el neto (sin IVA): el porcentaje del presupuesto neto, más los gastos si se suman. Se puede ajustar a mano.
    const amountCents = parsed.data.amountCents ?? Math.round(await resolveWorkNetBudget(before) * parsed.data.percentage / 100) + (parsed.data.includeExpenses ? expensesCents : 0);
    const certificate = { _id: new Types.ObjectId(), ...parsed.data, amountCents, files: parsed.data.files.map(file => ({ ...file, uploadedByName: session.name })), expensesCents, invoiced: false };
    const work = await Work.findByIdAndUpdate(id, { $push: { certificates: certificate } }, { returnDocument: "after" });
    if (parsed.data.approved) await notify({
      title: `Certificado ${parsed.data.number} listo para facturar`,
      body: `Obra ${work.code} — ${work.name}. Avance ${parsed.data.percentage}% · ${money(amountCents)} neto. Lo emitió ${session.name}.`,
      kind: "certificado", href: `/app/invoices?obra=${work._id}&certificado=${certificate._id}`, roles: ["administracion"], dedupeKey: `certificate-${work._id}-${parsed.data.number}`,
    });
    if (parsed.data.approved) await Task.create({ title: `Facturar certificado ${parsed.data.number} — ${work.name}`, type: "facturar_certificado", status: "pendiente", assigneeRole: "administracion", relatedType: "works", relatedId: work._id });
    await audit(session, "add_certificate", "works", id, before, work.toObject());
    return Response.json(work, { status: 201 });
  } catch (error) { return apiError(error); }
}
