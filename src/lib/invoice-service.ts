import { Client, Collection, Invoice, Work } from "./models";
import { HttpError } from "./api";
import { formatVoucherNumber, isFiscalVoucher, voucherLabels, VOID_INVOICE_STATUSES } from "./invoice-labels";
import { arcaBookFor, arcaCredentials, arcaEmitInvoice, arcaEnvironment, arcaPointsOfSale } from "./arca";
import { COMPANIES, companyOf } from "./companies";
import { vatConditionFor } from "./fiscal";
import { applyInvoiceCollection } from "./balances";

export { invoiceLabel, voucherLabels, VOUCHER_TYPES } from "./invoice-labels";

/**
 * Antes de guardar una factura (alta o cambio):
 * - con el neto cargado, el IVA y el total salen de ahí;
 * - la cotización y la obra se completan una con la otra;
 * - el estado sale de lo cobrado (lo mueven los recibos), salvo que se la anule.
 * `data` es lo que se va a guardar y se completa en el lugar; `before`, la factura como estaba.
 */
export async function prepareInvoice(data: Record<string, unknown>, before: Record<string, unknown> = {}) {
  const merged = { ...before, ...data };
  const net = Number(merged.netCents || 0);
  if (("netCents" in data || "vatPct" in data) && net > 0) {
    const pct = Number(merged.vatPct ?? 21);
    const vat = Math.round(net * pct / 100);
    Object.assign(data, { vatPct: pct, vatCents: vat, amountCents: net + vat });
  }

  if ("quoteId" in data || "workId" in data) {
    if (merged.workId && !merged.quoteId) {
      const work = await Work.findById(merged.workId).select("quoteId").lean() as { quoteId?: unknown } | null;
      if (work?.quoteId) data.quoteId = work.quoteId;
    } else if (merged.quoteId && !merged.workId) {
      const work = await Work.findOne({ quoteId: merged.quoteId }).select("_id").lean() as { _id: unknown } | null;
      if (work) data.workId = work._id;
    }
  }

  const status = String(data.status ?? before.status ?? "");
  if (!VOID_INVOICE_STATUSES.includes(status)) {
    const amount = Number(data.amountCents ?? before.amountCents ?? 0);
    const collected = Number(before.collectedCents ?? data.collectedCents ?? 0);
    data.status = amount > 0 && collected >= amount ? "cobrada" : collected > 0 ? "parcial" : "pendiente";
  }
}

/**
 * Una X que se reemplaza por un comprobante fiscal (punto 9). Las dos quedan
 * atadas: la X pasa a "sustituida" y deja de contar, y lo que ya se había
 * cobrado de ella (los recibos) pasa a la fiscal. No se duplica la venta, la
 * deuda del cliente ni el cobro.
 */
export async function checkSubstitution(data: Record<string, unknown>) {
  if (!data.replacesId) return null;
  const original = await Invoice.findById(data.replacesId).lean<Record<string, unknown>>();
  if (!original) throw new HttpError("La factura X que se sustituye no existe");
  if (original.voucherType !== "factura_x") throw new HttpError("Solo una Factura X se sustituye por un comprobante fiscal");
  if (VOID_INVOICE_STATUSES.includes(String(original.status))) throw new HttpError("Esa Factura X ya está anulada o sustituida");
  if (!isFiscalVoucher(data.voucherType)) throw new HttpError("La X se sustituye por una Factura A o B");
  if (String(original.clientId) !== String(data.clientId)) throw new HttpError("La factura fiscal tiene que ser del mismo cliente que la X");
  return original;
}

export async function completeSubstitution(original: Record<string, unknown>, replacement: { _id: unknown }) {
  const xId = original._id;
  // Los recibos que cobraban la X ahora cobran la fiscal: se mueve la aplicación, no se cobra dos veces.
  const collections = await Collection.find({ $or: [{ invoiceId: xId }, { "allocations.invoiceId": xId }] });
  let moved = 0;
  for (const collection of collections) {
    if (String(collection.invoiceId || "") === String(xId)) collection.invoiceId = replacement._id;
    for (const allocation of collection.allocations || []) {
      if (String(allocation.invoiceId) === String(xId)) { allocation.invoiceId = replacement._id; moved += Number(allocation.amountCents || 0); }
    }
    if (!collection.allocations?.length && String(collection.invoiceId) === String(replacement._id)) moved += Number(collection.amountCents || 0);
    await collection.save();
  }
  await Invoice.updateOne({ _id: xId }, { $set: { status: "sustituida", replacedById: replacement._id } });
  if (moved) await applyInvoiceCollection(replacement._id, moved);
}

/*
 * Emitir en ARCA (punto 9: las fiscales salen del sistema con CAE). El punto
 * de venta sale de arcaBookFor; el número lo pone ARCA.
 */
export async function emitInvoiceInArca(data: Record<string, unknown>) {
  const company = companyOf(data.company).key;
  const voucherType = data.voucherType;
  if (voucherType !== "factura_a" && voucherType !== "factura_b") throw new HttpError("En ARCA se emiten la Factura A y la B; la X es interna");
  if (!arcaCredentials(company)) throw new HttpError(`${COMPANIES[company].short} no está conectada con ARCA: falta su certificado en el servidor`);

  const client = await Client.findById(data.clientId).select("name cuit vatCondition").lean<{ name: string; cuit?: string; vatCondition?: string }>();
  if (!client) throw new HttpError("El cliente no existe");

  const enabled = (await arcaPointsOfSale(company)).filter(point => !point.blocked && !point.closed).map(point => point.number);
  const book = await arcaBookFor(company, voucherType, enabled);
  if (!book) throw new HttpError(`${COMPANIES[company].short} no tiene un talonario de ${voucherLabels[voucherType]} en un punto de venta de web services de ARCA (${enabled.map(number => String(number).padStart(4, "0")).join(", ") || "ninguno"}). Se agrega en Configuración > Empresas y comprobantes.`);

  const pointOfSale = Number(book.pointOfSale);
  const emitted = await arcaEmitInvoice(company, {
    voucherType, pointOfSale,
    concept: Array.isArray(data.remitoIds) && data.remitoIds.length ? 1 : 2,
    clientCuit: String(client.cuit || ""), vatCondition: vatConditionFor(voucherType, client.vatCondition),
    issueDate: new Date(data.issueDate as string | Date), dueDate: data.dueDate ? new Date(data.dueDate as string | Date) : undefined,
    netCents: Number(data.netCents || 0), vatPct: Number(data.vatPct ?? 21), vatCents: Number(data.vatCents || 0), amountCents: Number(data.amountCents || 0),
  });
  Object.assign(data, {
    pointOfSale: book.pointOfSale, number: formatVoucherNumber(book.pointOfSale, emitted.number),
    cae: emitted.cae, caeDueDate: emitted.caeDueDate, arcaEnvironment: arcaEnvironment(),
  });
  return emitted;
}

/** Lo que una factura con CAE ya no puede cambiar: está autorizada así en ARCA. */
const FISCAL_FIELDS = ["company", "voucherType", "pointOfSale", "number", "clientId", "issueDate", "netCents", "vatPct", "vatCents", "amountCents"];

export function checkFiscalChanges(before: Record<string, unknown>, changes: Record<string, unknown>) {
  if (!before.cae) return;
  const changed = FISCAL_FIELDS.filter(key => key in changes && String(changes[key] ?? "") !== String(before[key] ?? "")
    && !(changes[key] instanceof Date && before[key] instanceof Date && changes[key].getTime() === before[key].getTime()));
  if (changes.status === "anulada" && before.status !== "anulada") throw new HttpError("La factura está emitida en ARCA con CAE: no se anula desde acá. Para anularla hace falta una nota de crédito.");
  if (changed.length) throw new HttpError("La factura ya está emitida en ARCA con CAE: el cliente, la fecha, el número y los importes no se cambian. Para corregirla hace falta una nota de crédito.");
}
