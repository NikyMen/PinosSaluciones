import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { StockItem, StockTrash } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";

/** Devuelve un material de la papelera al stock, con el mismo id y lo que tenía. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const row = await StockTrash.findById(id).lean();
    if (!row) return Response.json({ error: "No está en la papelera" }, { status: 404 });
    if (await StockItem.exists({ _id: row.item._id })) return Response.json({ error: "El material ya está en el stock" }, { status: 409 });
    await StockItem.collection.insertOne(row.item);
    await StockTrash.deleteOne({ _id: id });
    await audit(session, "restore", "stock", row.item._id, null, row.item, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
