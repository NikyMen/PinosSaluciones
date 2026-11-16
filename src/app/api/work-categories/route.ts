import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { apiError, HttpError } from "@/lib/api";
import { WorkCategory } from "@/lib/models";
import { listWorkCategories } from "@/lib/work-categories";

const schema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i).optional(), name: z.string().trim().min(1).max(100), allowed: z.boolean() });

export async function GET() {
  try {
    await requireSession();
    await connectDB();
    return Response.json({ items: await listWorkCategories() });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    const result = schema.safeParse(await request.json());
    if (!result.success) throw new HttpError("Revisá el nombre y el estado del rubro");
    await connectDB();
    await listWorkCategories();
    const { id, name, allowed } = result.data;
    const item = id ? await WorkCategory.findByIdAndUpdate(id, { name, allowed }, { returnDocument: "after" })
      : await WorkCategory.create({ key: randomUUID(), name, allowed });
    if (!item) throw new HttpError("Rubro no encontrado", 404);
    return Response.json(item);
  } catch (error) { return apiError(error); }
}
