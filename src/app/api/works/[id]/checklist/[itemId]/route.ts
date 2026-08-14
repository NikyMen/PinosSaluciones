import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Work } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";

const schema = z.object({ title: z.string().trim().min(1).max(240).optional(), done: z.boolean().optional() }).refine(value => Object.keys(value).length > 0);

export async function PATCH(request: Request, context: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const { id, itemId } = await context.params;
    if (!isValidObjectId(id) || !isValidObjectId(itemId)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Cambio inválido" }, { status: 400 });
    await connectDB();
    const work = await Work.findById(id);
    if (!work) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    const item = work.checklist.id(itemId);
    if (!item) return Response.json({ error: "Tarea no encontrada" }, { status: 404 });
    const before = item.toObject();
    const now = new Date();
    if (parsed.data.title !== undefined) item.title = parsed.data.title;
    if (parsed.data.done !== undefined) {
      item.done = parsed.data.done;
      item.completedAt = parsed.data.done ? now : undefined;
    }
    item.createdAt ||= work.createdAt || now;
    item.updatedAt = now;
    await work.save();
    await audit(session, "update_checklist_item", "works", id, before, item.toObject());
    return Response.json(item);
  } catch (error) { return apiError(error); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const { id, itemId } = await context.params;
    if (!isValidObjectId(id) || !isValidObjectId(itemId)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const work = await Work.findById(id);
    if (!work) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    const item = work.checklist.id(itemId);
    if (!item) return Response.json({ error: "Tarea no encontrada" }, { status: 404 });
    const before = item.toObject();
    item.deleteOne();
    await work.save();
    await audit(session, "delete_checklist_item", "works", id, before, null);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
