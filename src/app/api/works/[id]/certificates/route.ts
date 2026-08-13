import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Work, Task } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";

const schema = z.object({ number: z.string().trim().min(1), period: z.string().trim().min(1), percentage: z.coerce.number().min(0).max(100), amountCents: z.coerce.number().int().min(0), approved: z.boolean().default(false), file: z.string().optional().default("") });

export async function POST(request: Request, context: RouteContext<"/api/works/[id]/certificates">) {
  try {
    const session = await requireSession(); if (!canWrite(session.role, "works")) throw new Error("FORBIDDEN");
    const { id } = await context.params; if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json()); if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });
    await connectDB(); const before = await Work.findById(id).lean(); if (!before) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    const certificate = { ...parsed.data, invoiced: false };
    const work = await Work.findByIdAndUpdate(id, { $push: { certificates: certificate } }, { new: true });
    if (parsed.data.approved) await Task.create({ title: `Facturar certificado ${parsed.data.number} — ${work.name}`, type: "facturar_certificado", status: "pendiente", assigneeRole: "administracion", relatedType: "works", relatedId: work._id });
    await audit(session, "add_certificate", "works", id, before, work.toObject());
    return Response.json(work, { status: 201 });
  } catch (error) { return apiError(error); }
}
