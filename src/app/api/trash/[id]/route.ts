import { isValidObjectId } from "mongoose";
import { isOwnerEmail, requireSession } from "@/lib/auth";
import { canDelete, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { modelByEntity, StockTrash } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { isTrashEntity } from "@/lib/trash";

type Row = { _id: unknown; entity?: string; item: { _id: unknown } & Record<string, unknown>; purgedAt?: Date };

async function findRow(id: string) {
  if (!isValidObjectId(id)) return null;
  const row = await StockTrash.findOne({ _id: id, purgedAt: null }).lean<Row>();
  const entity = row?.entity || "stock";
  return row && isTrashEntity(entity) ? { row, entity } : null;
}

/** Devuelve el registro a su sección, con el mismo id y lo que tenía: vuelve a contar en los números. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    await connectDB();
    const found = await findRow(id);
    if (!found) return Response.json({ error: "No está en la papelera" }, { status: 404 });
    const { row, entity } = found;
    if (!canWrite(session, entity)) throw new Error("FORBIDDEN");
    const model = modelByEntity[entity];
    if (await model.exists({ _id: row.item._id })) return Response.json({ error: "Ya está de vuelta en su sección" }, { status: 409 });
    await model.collection.insertOne(row.item as never);
    await StockTrash.deleteOne({ _id: id });
    await audit(session, "restore", entity, row.item._id, null, row.item, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}

/**
 * La saca de la papelera para siempre. Solo gerencia o el dueño de la cuenta.
 * Queda la marca (purgedAt) para que lo que generó siga sin contar en los números.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canDelete(session) && !isOwnerEmail(session.email)) return Response.json({ error: "Solo gerencia o el administrador pueden eliminar definitivamente" }, { status: 403 });
    const { id } = await context.params;
    await connectDB();
    const found = await findRow(id);
    if (!found) return Response.json({ error: "No está en la papelera" }, { status: 404 });
    await StockTrash.updateOne({ _id: id }, { $set: { purgedAt: new Date(), purgedByName: session.name } });
    await audit(session, "purge", found.entity, found.row.item._id, found.row.item, null, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
