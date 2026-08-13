import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Quote, Work } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";

const schema = z.object({ code: z.string().trim().min(1), name: z.string().trim().min(1), startDate: z.coerce.date().optional() });
export async function POST(request: Request, context: RouteContext<"/api/quotes/[id]/convert">) {
  try {
    const session = await requireSession(); if (!canWrite(session.role, "quotes")) throw new Error("FORBIDDEN");
    const { id } = await context.params; if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json()); if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });
    await connectDB(); const quote = await Quote.findById(id); if (!quote) return Response.json({ error: "Cotización no encontrada" }, { status: 404 });
    const existing = await Work.findOne({ quoteId: quote._id }); if (existing) return Response.json({ error: "La cotización ya tiene una obra" }, { status: 409 });
    quote.status = "aprobada"; await quote.save();
    const work = await Work.create({ ...parsed.data, clientId: quote.clientId, quoteId: quote._id, budgetCents: quote.amountCents, status: "planificada" });
    await audit(session, "convert_to_work", "quotes", quote._id, null, work.toObject());
    return Response.json(work, { status: 201 });
  } catch (error) { return apiError(error); }
}
