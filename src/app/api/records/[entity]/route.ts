import { connectDB } from "@/lib/db";
import { entities, type Entity } from "@/lib/constants";
import { modelByEntity } from "@/lib/models";
import { schemas, sanitizeSearch } from "@/lib/schemas";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { applyExpensePayment, applyInvoiceCollection } from "@/lib/balances";

function validEntity(value: string): value is Entity { return entities.includes(value as Entity); }

export async function GET(request: Request, context: RouteContext<"/api/records/[entity]">) {
  try {
    const session = await requireSession();
    const { entity } = await context.params;
    if (!validEntity(entity) || !canRead(session, entity)) throw new Error("FORBIDDEN");
    await connectDB();
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));
    const search = sanitizeSearch(url.searchParams.get("search") || "");
    const filter = search ? { $or: ["name", "title", "number", "code", "description", "bank"].map(key => ({ [key]: { $regex: search, $options: "i" } })) } : {};
    const model = modelByEntity[entity];
    const [items, total] = await Promise.all([
      model.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      model.countDocuments(filter),
    ]);
    return Response.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: RouteContext<"/api/records/[entity]">) {
  try {
    const session = await requireSession();
    const { entity } = await context.params;
    if (!validEntity(entity) || !canWrite(session, entity)) throw new Error("FORBIDDEN");
    const parsed = schemas[entity].safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
    await connectDB();
    const model = modelByEntity[entity];
    const item = await model.create(parsed.data as never);

    if (entity === "collections") await applyInvoiceCollection(item.invoiceId, item.amountCents);
    if (entity === "payments") await applyExpensePayment(item.expenseId, item.amountCents);
    await audit(session, "create", entity, item._id, null, item.toObject(), request.headers.get("x-forwarded-for") || undefined);
    return Response.json(item, { status: 201 });
  } catch (error) { return apiError(error); }
}
