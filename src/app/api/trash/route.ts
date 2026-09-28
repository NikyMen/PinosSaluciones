import { isOwnerEmail, requireSession } from "@/lib/auth";
import { canDelete, canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { StockTrash } from "@/lib/models";
import { apiError } from "@/lib/api";
import { isTrashEntity, trashOf } from "@/lib/trash";

/** Lo que está en la papelera de una sección (?entity=stock|works|clients), el último primero. */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const entity = new URL(request.url).searchParams.get("entity");
    if (!isTrashEntity(entity) || !canRead(session, entity)) throw new Error("FORBIDDEN");
    await connectDB();
    const rows = await StockTrash.find({ ...trashOf(entity), purgedAt: null }).sort({ deletedAt: -1 }).limit(200).lean();
    return Response.json({
      items: rows.map(row => ({ _id: String(row._id), name: row.name, category: row.item?.category || "", quantity: Number(row.item?.quantity || 0), deletedAt: row.deletedAt, deletedByName: row.deletedByName || "" })),
      // Borrar para siempre queda para gerencia y el dueño de la cuenta.
      canPurge: canDelete(session) || isOwnerEmail(session.email),
    });
  } catch (error) { return apiError(error); }
}
