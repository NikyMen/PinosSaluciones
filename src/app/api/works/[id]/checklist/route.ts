import { isValidObjectId, Types } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Work } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";

const schema = z.object({ title: z.string().trim().min(1).max(240) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Ingresá una tarea válida" }, { status: 400 });
    await connectDB();
    const now = new Date();
    const item = { _id: new Types.ObjectId(), title: parsed.data.title, done: false, createdAt: now, updatedAt: now };
    const work = await Work.findByIdAndUpdate(id, { $push: { checklist: item } }, { new: true, runValidators: true });
    if (!work) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    await audit(session, "add_checklist_item", "works", id, null, item);
    return Response.json(item, { status: 201 });
  } catch (error) { return apiError(error); }
}
