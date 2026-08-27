import { connectDB } from "@/lib/db";
import { entities, type Entity } from "@/lib/constants";
import { composeWorkerName, modelByEntity, nextQuoteNumber, nextQuoteVersion } from "@/lib/models";
import { schemas, sanitizeSearch } from "@/lib/schemas";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { resolveTaskAssignee, taskScope } from "@/lib/tasks";
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
    const searchFilter = search ? { $or: ["name", "title", "number", "code", "description", "bank", "cuit", "contactName", "firstName", "lastName", "dni", "sku"].map(key => ({ [key]: { $regex: search, $options: "i" } })) } : {};
    const filter = entity === "tasks" ? { $and: [searchFilter, taskScope(session, url.searchParams)] } : searchFilter;
    const model = modelByEntity[entity];
    // En ventas interesa lo que se movio recien, no lo que se creo primero.
    const sort: Record<string, -1> = entity === "quotes" ? { updatedAt: -1 } : { createdAt: -1 };
    const [items, total] = await Promise.all([
      model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
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
    const data = parsed.data as Record<string, unknown>;
    if (entity === "quotes" && !data.number) data.number = await nextQuoteNumber();
    // La version no se elige a mano: sale de cuantas cotizaciones hay ya con ese titulo.
    if (entity === "quotes") data.version = await nextQuoteVersion(String(data.title || ""));
    if (entity === "tasks") await resolveTaskAssignee(session, data);
    if (entity === "workers") data.name = composeWorkerName(data);
    const item = await model.create(data as never);

    if (entity === "collections") await applyInvoiceCollection(item.invoiceId, item.amountCents);
    if (entity === "payments") await applyExpensePayment(item.expenseId, item.amountCents);
    await audit(session, "create", entity, item._id, null, item.toObject(), request.headers.get("x-forwarded-for") || undefined);
    return Response.json(item, { status: 201 });
  } catch (error) { return apiError(error); }
}
