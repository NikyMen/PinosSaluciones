import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Worker } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { deactivateWorker, reactivateWorker } from "@/lib/worker-files";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("baja"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Poné la fecha de la baja"), reason: z.string().trim().max(300).optional().default("") }),
  z.object({ action: z.literal("alta"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Poné la fecha en que vuelve") }),
]);

/** Dar de baja a un integrante, o reactivarlo con un legajo nuevo. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "workers")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const before = await Worker.findById(id).lean();
    const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
    const worker = parsed.data.action === "baja"
      ? await deactivateWorker(id, date, parsed.data.reason)
      : await reactivateWorker(id, date);
    await audit(session, parsed.data.action === "baja" ? "worker_leave" : "worker_return", "workers", id, before, worker, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(worker);
  } catch (error) { return apiError(error); }
}
