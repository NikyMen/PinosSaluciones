import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { entities, type Entity } from "@/lib/constants";
import { composeWorkerName, modelByEntity } from "@/lib/models";
import { schemas } from "@/lib/schemas";
import { requireSession } from "@/lib/auth";
import { canDelete, canRead, canWrite } from "@/lib/permissions";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { applyExpensePayment, applyInvoiceCollection } from "@/lib/balances";

function validEntity(value: string): value is Entity { return entities.includes(value as Entity); }

export async function GET(_request: Request, context: RouteContext<"/api/records/[entity]/[id]">) {
  try {
    const session = await requireSession(); const { entity, id } = await context.params;
    if (!validEntity(entity) || !canRead(session, entity)) throw new Error("FORBIDDEN");
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB(); const item = await modelByEntity[entity].findById(id).lean();
    return item ? Response.json(item) : Response.json({ error: "No encontrado" }, { status: 404 });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: RouteContext<"/api/records/[entity]/[id]">) {
  try {
    const session = await requireSession(); const { entity, id } = await context.params;
    if (!validEntity(entity) || !canWrite(session, entity)) throw new Error("FORBIDDEN");
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schemas[entity].partial().safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
    await connectDB(); const model = modelByEntity[entity]; const before = await model.findById(id).lean();
    if (!before) return Response.json({ error: "No encontrado" }, { status: 404 });
    const changes = parsed.data as Record<string, unknown>;
    if (entity === "workers" && (changes.firstName || changes.lastName)) {
      changes.name = composeWorkerName({ ...before as Record<string, unknown>, ...changes });
    }
    const item = await model.findByIdAndUpdate(id, { $set: changes }, { new: true, runValidators: true }).lean();
    if (entity === "quotes" && item && (before as Record<string, unknown>).status !== (item as Record<string, unknown>).status) {
      const { Quote } = await import("@/lib/models");
      await Quote.updateOne({ _id: id }, { $push: { history: { action: `Estado: ${(item as Record<string, unknown>).status}`, at: new Date(), userId: session.userId } } });
    }
    if (entity === "collections" && item) {
      await applyInvoiceCollection((before as Record<string, unknown>).invoiceId, -Number((before as Record<string, unknown>).amountCents || 0));
      await applyInvoiceCollection((item as Record<string, unknown>).invoiceId, Number((item as Record<string, unknown>).amountCents || 0));
    }
    if (entity === "payments" && item) {
      await applyExpensePayment((before as Record<string, unknown>).expenseId, -Number((before as Record<string, unknown>).amountCents || 0));
      await applyExpensePayment((item as Record<string, unknown>).expenseId, Number((item as Record<string, unknown>).amountCents || 0));
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
    await model.findByIdAndDelete(id);
    if (entity === "collections") await applyInvoiceCollection((before as Record<string, unknown>).invoiceId, -Number((before as Record<string, unknown>).amountCents || 0));
    if (entity === "payments") await applyExpensePayment((before as Record<string, unknown>).expenseId, -Number((before as Record<string, unknown>).amountCents || 0));
    await audit(session, "delete", entity, id, before, null, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
