import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { SalesRemito } from "@/lib/models";
import { cancelSalesRemito } from "@/lib/sales-remitos";

const schema = z.object({ reason: z.string().trim().min(3, "Contá por qué se anula").max(300) });

/** Anula un remito sin facturar: el material vuelve al Salón. No se borra: queda anulado con el motivo. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const before = await SalesRemito.findById(id).lean();
    const after = await cancelSalesRemito(id, parsed.data.reason, session);
    await audit(session, "update", "sales_remitos", id, before, after, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(after);
  } catch (error) { return apiError(error); }
}
