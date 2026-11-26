import { connectDB } from "@/lib/db";
import { entities, type Entity } from "@/lib/constants";
import { composeWorkerName, modelByEntity, nextReceiptNumber, nextQuoteNumber, nextQuoteVersion } from "@/lib/models";
import { afterPaymentChange, refreshOrderPayment } from "@/lib/purchase-flow";
import { schemas, sanitizeSearch } from "@/lib/schemas";
import { requireSession } from "@/lib/auth";
import { canApprovePurchases, canRead, canViewWorkBudget, canWrite } from "@/lib/permissions";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { recordSalePriceChange } from "@/lib/sale-prices";
import { resolveTaskAssignee, taskScope } from "@/lib/tasks";
import { applyCollection, applyPayment } from "@/lib/balances";
import { createInvoice } from "@/lib/invoice-create";
import { beforeCreate } from "@/lib/document-rules";
import { ensureAccountCatalog } from "@/lib/account-service";
import { prepareNewWorker } from "@/lib/worker-files";
import { withLastPrices } from "@/lib/stock-prices";
import { cashAccountBalances, type CashAccountDoc } from "@/lib/cash-accounts";
import { invoiceListSummary, pendingInvoiceFilter } from "@/lib/invoice-summary";
import { creditNotesFilter, creditSummary } from "@/lib/credit-notes";
import { workHolidays } from "@/lib/work-calendar";
import { businessDaysBetween } from "@/lib/business-days";
import { DEFAULT_WAREHOUSE, isWarehouse } from "@/lib/warehouses";

function validEntity(value: string): value is Entity { return entities.includes(value as Entity); }

/*
 * Lo que un listado no necesita. Una obra arrastra todas sus horas cargadas,
 * su historial y su checklist; una cotización, su análisis de precios; un
 * material, cada entrada y salida. Nada de eso se ve en la tabla ni en los
 * selects de otros módulos, y con el uso crece mes a mes: se deja afuera y lo
 * pide la pantalla de detalle cuando hace falta.
 */
const listProjection: Partial<Record<Entity, Record<string, unknown>>> = {
  works: { labor: 0, activity: 0, checklist: 0, advances: 0, progressBase: 0 },
  quotes: { items: 0, overheads: 0, cascade: 0, history: 0 },
  stock: { movements: { $slice: -12 } },
  assets: { maintenance: 0, plans: 0 },
};

export async function GET(request: Request, context: RouteContext<"/api/records/[entity]">) {
  try {
    const session = await requireSession();
    const { entity } = await context.params;
    if (!validEntity(entity) || !canRead(session, entity)) throw new Error("FORBIDDEN");
    await connectDB();
    if (entity === "accounts") await ensureAccountCatalog();
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    // El plan de cuentas entero entra en un select: son menos de 200.
    const limit = Math.min(entity === "accounts" ? 300 : 100, Math.max(1, Number(url.searchParams.get("limit") || 20)));
    const search = sanitizeSearch(url.searchParams.get("search") || "");
    // En el personal también se busca por número de legajo; en las cajas, proveedores y clientes, por su código (es un número: no va con el texto).
    // Las cajas, los proveedores y los clientes tienen código numérico.
    const numericCode = entity === "cashAccounts" || entity === "suppliers" || entity === "clients";
    const byFileNumber = entity === "workers" && /^\d{1,6}$/.test(search) ? [{ fileNumber: Number(search) }] : numericCode && /^\d{1,6}$/.test(search) ? [{ code: Number(search) }]
      // Un CUIT escrito sin guiones encuentra al que se guardó con guiones.
      : /^\d{11}$/.test(search) ? [{ cuit: `${search.slice(0, 2)}-${search.slice(2, 10)}-${search.slice(10)}` }] : [];
    const searchFilter = search ? { $or: [...["name", "title", "number", "code", "description", "bank", "cuit", "contactName", "firstName", "lastName", "dni", "sku", "barcode", "position", "workType", "identifier", "brand", "responsible", "tradeName"].filter(key => !(numericCode && key === "code")).map(key => ({ [key]: { $regex: search, $options: "i" } })), ...byFileNumber] } : {};
    // Stock por depósito: lo que tiene existencia ahí o un mínimo cargado (para ver lo que falta).
    const warehouse = url.searchParams.get("warehouse");
    // Los materiales de antes (sin cantidad por depósito) tienen todo en el Galpón, como lee levelsOf.
    const legacy = warehouse === DEFAULT_WAREHOUSE ? [{ qty_central: { $exists: false }, qty_salon: { $exists: false }, $or: [{ quantity: { $gt: 0 } }, { minQuantity: { $gt: 0 } }] }] : [];
    const warehouseFilter = entity === "stock" && isWarehouse(warehouse) ? { $or: [{ [`qty_${warehouse}`]: { $gt: 0 } }, { [`min_${warehouse}`]: { $gt: 0 } }, ...legacy] } : null;
    const invoiceEntity = entity === "expenses" || entity === "invoices" ? entity : null;
    // "A favor de clientes": las notas de crédito de venta con saldo sin aplicar.
    const pending = invoiceEntity && url.searchParams.get("pending") === "1" ? pendingInvoiceFilter(invoiceEntity)
      : entity === "invoices" && url.searchParams.get("credit") === "1" ? creditNotesFilter : null;
    const filter = entity === "tasks" ? { $and: [searchFilter, taskScope(session, url.searchParams)] }
      : warehouseFilter || pending ? { $and: [searchFilter, warehouseFilter || pending!] } : searchFilter;
    const model = modelByEntity[entity];
    // En ventas interesa lo que se movio recien, no lo que se creo primero. El plan de cuentas y las cajas van por código.
    const sort: Record<string, 1 | -1> = entity === "quotes" ? { updatedAt: -1 } : entity === "accounts" || entity === "cashAccounts" ? { code: 1, name: 1 } : { createdAt: -1 };
    const projection = entity === "works" && !canViewWorkBudget(session) ? { ...listProjection.works, budgetCents: 0, budgetNetCents: 0 } : listProjection[entity] || {};
    const [items, total, summary] = await Promise.all([
      model.find(filter, projection).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      model.countDocuments(filter),
      invoiceEntity && url.searchParams.get("summary") === "1" ? invoiceListSummary(invoiceEntity).then(async totals => entity === "invoices" ? { ...totals, ...await creditSummary() } : totals) : undefined,
    ]);
    if (entity === "works" && items.length) {
      const holidays = await workHolidays();
      // El avance esperado sale del plan: días hábiles transcurridos desde el inicio previsto sobre la duración prevista.
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
      for (const item of items as Array<{ startDate?: Date; endDate?: Date; durationBusinessDays?: number; expectedProgress?: number; status?: string }>) {
        if (!item.startDate || !item.endDate) continue;
        item.durationBusinessDays = businessDaysBetween(item.startDate, item.endDate, holidays);
        if (!item.durationBusinessDays || item.status === "cancelada") continue;
        const end = new Date(item.endDate).toISOString().slice(0, 10);
        const elapsed = businessDaysBetween(item.startDate, today < end ? today : end, holidays);
        item.expectedProgress = Math.round(Math.min(100, elapsed / item.durationBusinessDays * 100) * 10) / 10;
      }
    }
    // El maestro de cajas muestra el saldo de cada cuenta.
    if (entity === "cashAccounts") {
      const balances = await cashAccountBalances(items as CashAccountDoc[]);
      for (const item of items as Array<Record<string, unknown>>) item.balanceCents = balances.get(String(item._id)) ?? 0;
    }
    // El stock muestra el último precio de cada material, con su fecha.
    if (entity === "purchases") for (const item of items as Array<Record<string, unknown>>) item.canApprovePurchase = canApprovePurchases(session, Number(item.amountCents || 0));
    return Response.json({ items: entity === "stock" ? await withLastPrices(items as Record<string, unknown>[]) : items, summary, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
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
    if (entity === "workers") { data.name = composeWorkerName(data); await prepareNewWorker(data); }
    const ip = request.headers.get("x-forwarded-for") || undefined;
    // La factura tiene su propio circuito (remitos, ARCA, sustitución): src/lib/invoice-create.ts.
    if (entity === "invoices") return Response.json(await createInvoice(data, session, ip), { status: 201 });
    await beforeCreate(entity, data, session);
    if (entity === "collections") { if (!data.number) data.number = await nextReceiptNumber(); data.userName = session.name; }
    const item = await model.create(data as never);

    if (entity === "collections") await applyCollection(item, 1);
    if (entity === "payments") await applyPayment(item.toObject(), 1);
    if (entity === "payments") await afterPaymentChange(null, item.toObject(), session);
    // Una factura de una OC ya pagada de contado o con anticipo queda cubierta por ese pago.
    if (entity === "expenses" && item.purchaseId) await refreshOrderPayment(item.purchaseId);
    // El precio cargado en el alta (si lo tomó de la lista de un proveedor, ya lo anotó el modelo).
    if (entity === "stock" && Number(data.salePriceCents) > 0) await recordSalePriceChange(item._id, undefined, item.salePriceCents, session, "alta");
    await audit(session, "create", entity, item._id, null, item.toObject(), ip);
    return Response.json(item, { status: 201 });
  } catch (error) { return apiError(error); }
}
