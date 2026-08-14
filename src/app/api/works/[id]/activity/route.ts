import { isValidObjectId, Types } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Work } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";

const photo = z.string().regex(/^\/api\/uploads\/[a-f\d-]+\.(jpg|png|webp)$/i);
const schema = z.object({ detail: z.string().trim().min(1).max(5000), photos: z.array(photo).max(8).default([]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Ingresá un detalle válido y hasta 8 imágenes" }, { status: 400 });
    await connectDB();
    const entry = { _id: new Types.ObjectId(), ...parsed.data, userId: new Types.ObjectId(session.userId), authorName: session.name, createdAt: new Date() };
    const work = await Work.findByIdAndUpdate(id, { $push: { activity: entry } }, { new: true, runValidators: true });
    if (!work) return Response.json({ error: "Obra no encontrada" }, { status: 404 });
    await audit(session, "add_work_activity", "works", id, null, entry);
    return Response.json(entry, { status: 201 });
  } catch (error) { return apiError(error); }
}
