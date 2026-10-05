import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { entities, type Entity } from "@/lib/constants";
import { composeWorkerName, modelByEntity } from "@/lib/models";
import { schemas } from "@/lib/schemas";
import { requireSession } from "@/lib/auth";
import { canDelete, canRead, canWrite } from "@/lib/permissions";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { canSeeTask, resolveTaskAssignee } from "@/lib/tasks";
import { applyCollection, applyExpensePayment, paidByPayment } from "@/lib/balances";
import { beforeUpdate } from "@/lib/document-rules";
import { releaseRemitos } from "@/lib/sales-remitos";
import { releaseForQuote, reserveForQuote } from "@/lib/reservations";
import { VOID_INVOICE_STATUSES } from "@/lib/invoice-labels";
import { prepareInvoice } from "@/lib/invoice-service";
import { prepareWorkerChanges } from "@/lib/worker-files";
import { isTrashEntity } from "@/lib/trash";
import { refreshAssetSchedule } from "@/lib/asset-service";

function validEntity(value: string): value is Entity { return entities.includes(value as Entity); }

export async function GET(_request: Request, context: RouteContext<"/api/records/[entity]/[id]">) {
  try {
    const session = await requireSession(); const { entity, id } = await context.params;
    if (!validEntity(entity) || !canRead(session, entity)) throw new Error("FORBIDDEN");
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB(); const item = await modelByEntity[entity].findById(id).lean();
    if (!item) return Response.json({ error: "No encontrado" }, { status: 404 });
    // Una tarea de otra area no se lee ni sabiendo el id.
    if (entity === "tasks" && !canSeeTask(session, item as Record<string, unknown>)) return Response.json({ error: "No encontrado" }, { status: 404 });
    return Response.json(item);
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: RouteContext<"/api/records/[entity]/[id]">) {
  try {
    const session = await requireSession(); const { entity, id } = await context.params;
    if (!validEntity(entity) || !canWrite(session, entity)) throw new Error("FORBIDDEN");
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const body = await request.json();
    const parsed = schemas[entity].partial().safeParse(body);
    if (!parsed.success) return Response.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
    await connectDB(); const model = modelByEntity[entity]; const before = await model.findById(id).lean();
    if (!before) return Response.json({ error: "No encontrado" }, { status: 404 });
    // En un cambio parcial zod igual completa los valores por defecto de lo que
    // no llegó (una descripción vacía, activo = sí). Sólo se guarda lo que se
    // mandó: cambiar el estado de una tarea no puede borrarle la descripción.
    const sent = new Set(body && typeof body === "object" ? Object.keys(body) : []);
    const changes = Object.fromEntries(Object.entries(parsed.data as Record<string, unknown>).filter(([key]) => sent.has(key)));
    if (entity === "tasks") await resolveTaskAssignee(session, changes, false);
    if (entity === "invoices") await prepareInvoice(changes, before as Record<string, unknown>);
    if (entity === "workers") await prepareWorkerChanges(changes, id);
    const extra = await beforeUpdate(entity, before as Record<string, unknown>, changes, session);
    if (entity === "workers" && (changes.firstName || changes.lastName)) {
      changes.name = composeWorkerName({ ...before as Record<string, unknown>, ...changes });
    }
    const item = await model.findByIdAndUpdate(id, { $set: changes, ...extra }, { returnDocument: "after", runValidators: true }).lean();
    if (entity === "quotes" && item && (before as Record<string, unknown>).status !== (item as Record<string, unknown>).status) {
      const { Quote } = await import("@/lib/models");
      await Quote.updateOne({ _id: id }, { $push: { history: { action: `Estado: ${(item as Record<string, unknown>).status}`, at: new Date(), userId: session.userId } } });
      // Aprobada: reserva lo disponible y pasa el faltante a Compras. Si se cae, la reserva se libera.
      const status = String((item as Record<string, unknown>).status);
      if (status === "aprobada") await reserveForQuote(id, session);
      else if (status !== "convertida") await releaseForQuote(id, session);
    }
    // Una factura anulada libera sus remitos: vuelven a estar pendientes de facturar.
    if (entity === "invoices" && item && !VOID_INVOICE_STATUSES.includes(String((before as Record<string, unknown>).status)) && String((item as Record<string, unknown>).status) === "anulada") await releaseRemitos(id);
    // La lectura de uso pudo cambiar a mano: lo que vence por km u horas se recalcula y avisa.
    if (entity === "assets" && item && "currentReading" in changes) await refreshAssetSchedule(id);
    if (entity === "collections" && item) {
      await applyCollection(before as Record<string, unknown>, -1);
      await applyCollection(item as Record<string, unknown>, 1);
    }
    if (entity === "payments" && item) {
      await applyExpensePayment((before as Record<string, unknown>).expenseId, -paidByPayment(before as Record<string, unknown>));
      await applyExpensePayment((item as Record<string, unknown>).expenseId, paidByPayment(item as Record<string, unknown>));
    }
    const action = entity === "tasks" && (before as Record<string, unknown>).status !== (item as Record<string, unknown> | null)?.status
      ? "status_change"
      : "update";
    await audit(session, action, entity, id, before, item, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(item);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: RouteContext<"/api/records/[entity]/[id]">) {
  try {
    const session = await requireSession(); const { entity, id } = await context.params;
    if (!validEntity(entity) || !canDelete(session) || !canWrite(session, entity)) throw new Error("FORBIDDEN");
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB(); const model = modelByEntity[entity]; const before = await model.findById(id).lean();
    if (!before) return Response.json({ error: "No encontrado" }, { status: 404 });
    // Un material, una obra o un cliente no se pierden: van a la papelera con quién los borró y a qué hora.
    if (isTrashEntity(entity)) {
      const { StockTrash } = await import("@/lib/models");
      const record = before as Record<string, unknown>;
      const name = entity === "works" ? [record.code, record.name].filter(Boolean).join(" — ") : String(record.name || "");
      await StockTrash.create({ entity, item: before, name, deletedById: session.userId, deletedByName: session.name });
    }
    await model.findByIdAndDelete(id);
    if (entity === "invoices") await releaseRemitos(id);
    if (entity === "collections") await applyCollection(before as Record<string, unknown>, -1);
    if (entity === "payments") await applyExpensePayment((before as Record<string, unknown>).expenseId, -paidByPayment(before as Record<string, unknown>));
    await audit(session, "delete", entity, id, before, null, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
