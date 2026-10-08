import { connectDB } from "@/lib/db";
import { entities, type Entity } from "@/lib/constants";
import { composeWorkerName, modelByEntity, nextReceiptNumber, nextQuoteNumber, nextQuoteVersion } from "@/lib/models";
import { afterPaymentChange } from "@/lib/purchase-flow";
import { schemas, sanitizeSearch } from "@/lib/schemas";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { apiError, HttpError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { resolveTaskAssignee, taskScope } from "@/lib/tasks";
import { applyCollection, applyExpensePayment, paidByPayment } from "@/lib/balances";
import { applyCreditNote, checkNote, checkSubstitution, completeSubstitution, emitInvoiceInArca, prepareInvoice } from "@/lib/invoice-service";
import { beforeCreate } from "@/lib/document-rules";
import { Types } from "mongoose";
import { attachRemitos, checkRemitosForInvoice, claimRemitos, invoiceRemitoLines, unclaimRemitos } from "@/lib/sales-remitos";
import { checkInvoiceExcess } from "@/lib/quote-billing-service";
import { ensureAccountCatalog } from "@/lib/account-service";
import { prepareNewWorker } from "@/lib/worker-files";
import { withLastPrices } from "@/lib/stock-prices";
import { closeCertificate } from "@/lib/certificate-billing";
import { cashAccountBalances, type CashAccountDoc } from "@/lib/cash-accounts";

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
    // En el personal también se busca por número de legajo.
    const byFileNumber = entity === "workers" && /^\d{1,6}$/.test(search) ? [{ fileNumber: Number(search) }] : [];
    const searchFilter = search ? { $or: [...["name", "title", "number", "code", "description", "bank", "cuit", "contactName", "firstName", "lastName", "dni", "sku", "barcode", "position", "workType", "identifier", "brand", "responsible"].map(key => ({ [key]: { $regex: search, $options: "i" } })), ...byFileNumber] } : {};
    const filter = entity === "tasks" ? { $and: [searchFilter, taskScope(session, url.searchParams)] } : searchFilter;
    const model = modelByEntity[entity];
    // En ventas interesa lo que se movio recien, no lo que se creo primero. El plan de cuentas va por código.
    const sort: Record<string, 1 | -1> = entity === "quotes" ? { updatedAt: -1 } : entity === "accounts" ? { code: 1, name: 1 } : { createdAt: -1 };
    const [items, total] = await Promise.all([
      model.find(filter, listProjection[entity] || {}).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      model.countDocuments(filter),
    ]);
    // El maestro de cajas muestra el saldo de cada cuenta.
    if (entity === "cashAccounts") {
      const balances = await cashAccountBalances(items as CashAccountDoc[]);
      for (const item of items as Array<Record<string, unknown>>) item.balanceCents = balances.get(String(item._id)) ?? 0;
    }
    // El stock muestra el último precio de cada material, con su fecha.
    return Response.json({ items: entity === "stock" ? await withLastPrices(items as Record<string, unknown>[]) : items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
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
    await beforeCreate(entity, data, session);
    const replaced = entity === "invoices" ? await checkSubstitution(data) : null;
    // La factura referencia los remitos de venta que factura: no vuelve a descontar stock.
    if (entity === "invoices") await checkRemitosForInvoice(data);
    // La fiscal que sustituye una X factura lo mismo que la X de sus remitos.
    if (replaced) data.remitoLines = replaced.remitoLines;
    if (entity === "invoices") await prepareInvoice(data);
    // Una nota de débito o de crédito: con su factura asociada, del mismo cliente y la misma letra.
    if (entity === "invoices") await checkNote(data);
    // No pasa de lo que queda por facturar de su cotización, su certificado o sus remitos (salvo que Gerencia lo autorice).
    if (entity === "invoices") await checkInvoiceExcess(data, session);
    if (entity === "collections") { if (!data.number) data.number = await nextReceiptNumber(); data.userName = session.name; }
    // Emitir en ARCA: primero se revisa que la factura se pueda guardar, después se pide el CAE.
    const emitInArca = entity === "invoices" && data.arcaEmit === true;
    delete data.arcaEmit;
    // Los remitos se toman antes de emitir y guardar: dos facturas no pueden llevarse el mismo.
    // En una sustitución ya los tiene la X y pasan a la fiscal después de guardarla.
    const remitoIds = entity === "invoices" && Array.isArray(data.remitoIds) ? data.remitoIds : [];
    const remitoLines = entity === "invoices" ? invoiceRemitoLines(data) : [];
    const claim = remitoLines.length > 0 && !replaced;
    if (claim) { data._id = new Types.ObjectId(); await claimRemitos(data._id, remitoLines); }
    let item;
    try {
      if (emitInArca) {
        await new model({ ...data, number: data.number || "por-emitir" }).validate();
        await emitInvoiceInArca(data);
      }
      item = await model.create(data as never).catch(error => {
        if (!emitInArca) throw error;
        // Ya está autorizada en ARCA: que no se pierda el dato aunque no se haya podido guardar.
        console.error("Factura emitida en ARCA que no se pudo guardar", { company: data.company, number: data.number, cae: data.cae, error });
        throw new HttpError(`La factura quedó emitida en ARCA (${String(data.number)}, CAE ${String(data.cae)}) pero no se pudo guardar en el sistema. Cargala a mano con esos datos.`, 500);
      });
    } catch (error) {
      // Emitida en ARCA, los remitos quedan tomados: la factura existe aunque haya que cargarla a mano.
      if (claim && !data.cae) await unclaimRemitos(data._id, remitoLines);
      throw error;
    }

    if (replaced) await completeSubstitution(replaced, item);
    if (entity === "invoices" && remitoIds.length && !claim) await attachRemitos(item._id, remitoIds, replaced?._id);
    // La nota de crédito descuenta su importe de lo que se debe de la factura asociada.
    if (entity === "invoices") await applyCreditNote(item.toObject(), 1);
    if (entity === "collections") await applyCollection(item, 1);
    if (entity === "payments") await applyExpensePayment(item.expenseId, paidByPayment(item));
    if (entity === "payments") await afterPaymentChange(null, item.toObject(), session);
    if (entity === "invoices" && item.workId && (item.certificateId || item.certificateNumber)) await closeCertificate(item.toObject());
    await audit(session, "create", entity, item._id, null, item.toObject(), request.headers.get("x-forwarded-for") || undefined);
    return Response.json(item, { status: 201 });
  } catch (error) { return apiError(error); }
}
