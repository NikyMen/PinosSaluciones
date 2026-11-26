import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { createWorkFromQuote } from "@/lib/work-planning";

const schema = z.object({ code: z.string().trim().min(1), name: z.string().trim().min(1), startDate: z.coerce.date().optional() });
export async function POST(request: Request, context: RouteContext<"/api/quotes/[id]/convert">) {
  try {
    const session = await requireSession(); if (!canWrite(session, "quotes")) throw new Error("FORBIDDEN");
    const { id } = await context.params; if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json()); if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });
    await connectDB();
    // La misma alta que usa la planificación de la obra (src/lib/work-planning.ts).
    const work = await createWorkFromQuote(id, parsed.data, session);
    return Response.json(work, { status: 201 });
  } catch (error) { return apiError(error); }
}
