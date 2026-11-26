import { Client, Collection, Invoice, StockItem, Work } from "./models";
import { HttpError } from "./api";
import { baseInvoiceType, formatVoucherNumber, invoiceLabel, isCreditNote, isFiscalVoucher, isNote, voucherLabels, VOID_INVOICE_STATUSES } from "./invoice-labels";
import { arcaBookFor, arcaCredentials, arcaEmitInvoice, arcaEnvironment, arcaPointsOfSale } from "./arca";
import { COMPANIES, companyOf } from "./companies";
import { ARCA_VOUCHER_CODE, vatConditionFor, type ArcaVoucherType } from "./fiscal";
import { applyInvoiceCollection } from "./balances";
import { invoiceLinesGrossCents, type InvoiceLine } from "./invoice-lines";

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
  if (before._id && "withRemito" in data && data.withRemito !== before.withRemito) throw new HttpError("El modo de remito se fija al crear la factura");
  const remitos = Array.isArray(merged.remitoIds) && merged.remitoIds.length > 0;
  if (merged.withRemito === true && !remitos) throw new HttpError("Elegí al menos un remito de venta");
  if (merged.withRemito === false && remitos) throw new HttpError("Elegí Factura con remito para facturar remitos de venta");
  const lines = Array.isArray(merged.lines) ? merged.lines as InvoiceLine[] : [];
  // Con remitos, los productos vienen del remito; los renglones sueltos sólo pueden ser servicios o
  // conceptos sin stock (el Mostrador vende productos y servicios juntos). El neto lo trae la factura:
  // lo de los remitos más los servicios (checkInvoiceExcess controla que no pase de eso).
  if (remitos && lines.some(line => line.stockItemId)) throw new HttpError("Los productos de los remitos se cargan desde el remito");
  if (merged.withRemito === false && !lines.length && !isNote(merged.voucherType) && !merged.replacesId && (!before._id || Array.isArray(before.lines) && before.lines.length)) throw new HttpError("Agregá al menos un producto o concepto");
  if ("lines" in data && lines.length) {
    const products = [...new Set(lines.map(line => line.stockItemId).filter(Boolean))];
    if (products.length && await StockItem.countDocuments({ _id: { $in: products } }) !== products.length) throw new HttpError("Uno de los productos ya no existe en Stock");
  }
  if (lines.length && !remitos && ["lines", "netCents", "discountCents", "amountCents"].some(key => key in data)) {
    const net = invoiceLinesGrossCents(lines) - Number(merged.discountCents || 0);
    if (net < 0) throw new HttpError("El descuento pasa el subtotal");
    data.netCents = net;
    if (!net) Object.assign(data, { vatCents: 0, amountCents: 0 });
  }
  const net = Number(data.netCents ?? merged.netCents ?? 0);
  if (("netCents" in data || "vatPct" in data) && net > 0) {
    const pct = merged.voucherType === "factura_x" ? 0 : Number(merged.vatPct ?? 21);
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
  // La nota de crédito no se cobra: queda aplicada a su factura, por todo su importe.
  if (isCreditNote(merged.voucherType)) {
    if (!VOID_INVOICE_STATUSES.includes(status)) Object.assign(data, { status: "aplicada", collectedCents: Number(data.amountCents ?? before.amountCents ?? 0) });
    return;
  }
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
  const voucherType = data.voucherType as ArcaVoucherType;
  if (!(String(voucherType) in ARCA_VOUCHER_CODE)) throw new HttpError("En ARCA se emiten las facturas y notas A y B; la X es interna");
  if (!arcaCredentials(company)) throw new HttpError(`${COMPANIES[company].short} no está conectada con ARCA: falta su certificado en el servidor`);

  const client = await Client.findById(data.clientId).select("name cuit vatCondition").lean<{ name: string; cuit?: string; vatCondition?: string }>();
  if (!client) throw new HttpError("El cliente no existe");

  const enabled = (await arcaPointsOfSale(company)).filter(point => !point.blocked && !point.closed).map(point => point.number);
  const baseType = baseInvoiceType(voucherType) as "factura_a" | "factura_b";
  const book = await arcaBookFor(company, baseType, enabled);
  if (!book) throw new HttpError(`${COMPANIES[company].short} no tiene un talonario de ${voucherLabels[baseType]} en un punto de venta de web services de ARCA (${enabled.map(number => String(number).padStart(4, "0")).join(", ") || "ninguno"}). Se agrega en Perfil > Configuración > Empresas y comprobantes.`);

  // ARCA autoriza con fecha de hasta 5 días antes (productos) o 10 (servicios). Una factura vieja
  // ya se emitió: se carga a mano con su número (reunión con Tesorería, 10/11/2026).
  const lines = (data.lines || []) as InvoiceLine[];
  // Productos (1), servicios (2) o los dos (3). Los productos de los remitos cuentan como productos.
  const hasRemitos = Array.isArray(data.remitoIds) && data.remitoIds.length > 0;
  const products = lines.filter(line => line.stockItemId).length + (hasRemitos ? 1 : 0);
  const services = lines.filter(line => !line.stockItemId).length;
  const concept = products > 0 && !services ? 1 : products > 0 ? 3 : 2;
  const windowDays = concept === 1 ? 5 : 10;
  const issue = new Date(data.issueDate as string | Date);
  if (Number.isFinite(issue.getTime()) && Date.now() - issue.getTime() > (windowDays + 1) * 86_400_000) {
    throw new HttpError(`ARCA no autoriza una factura con fecha de más de ${windowDays} días atrás. Si ya la emitiste (en Tango o antes), elegí "Cargar una ya emitida" y escribí su número.`);
  }

  const pointOfSale = Number(book.pointOfSale);
  // Una nota va con la factura a la que corresponde (checkNote ya la validó).
  const associated = isNote(voucherType) && data.associatedInvoiceId ? await Invoice.findById(data.associatedInvoiceId).lean<Record<string, unknown>>() : null;
  // Sin referencia: ARCA recibe el período que corrige (lo dejó checkNote).
  const associatedPeriod = isNote(voucherType) && !associated ? data.associatedPeriod as { from: Date; to: Date } | undefined : undefined;
  const associatedNumber = String(associated?.number || "").match(/^(\d{1,5})-(\d{1,8})$/);
  if (associated && !associatedNumber) throw new HttpError(`La ${invoiceLabel(associated)} no tiene un número de ARCA (punto de venta y número): no se le puede asociar una nota`);
  // El número que mostró el formulario: si ARCA ya va por otro (alguien emitió mientras tanto), se avisa.
  const shown = String(data.number || "").match(/^(\d{1,5})-(\d{1,8})$/);
  const emitted = await arcaEmitInvoice(company, {
    voucherType, pointOfSale, expectedNumber: shown && Number(shown[1]) === pointOfSale ? Number(shown[2]) : undefined,
    associated: associated && associatedNumber ? {
      voucherCode: ARCA_VOUCHER_CODE[associated.voucherType as ArcaVoucherType] ?? 1, pointOfSale: Number(associatedNumber[1]), number: Number(associatedNumber[2]),
      cuit: COMPANIES[company].cuit, date: new Date(associated.issueDate as Date),
    } : undefined,
    associatedPeriod,
    concept,
    clientCuit: String(client.cuit || ""), vatCondition: vatConditionFor(voucherType, client.vatCondition),
    buyerDocument: data.buyerDocument ? String(data.buyerDocument) : undefined,
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
const FISCAL_FIELDS = ["company", "voucherType", "pointOfSale", "number", "clientId", "issueDate", "netCents", "vatPct", "vatCents", "amountCents", "associatedInvoiceId"];

export function checkFiscalChanges(before: Record<string, unknown>, changes: Record<string, unknown>) {
  // Una nota de crédito cargada a mano tampoco cambia: ya descontó su importe de la factura. Se borra y se carga de nuevo.
  if ((before.cae || isCreditNote(before.voucherType)) && "lines" in changes) throw new HttpError("Los renglones de esta factura ya están emitidos");
  if (changes.status === "anulada" && before.status !== "anulada") checkCreditNoteFree(before, "anular");
  if (!before.cae && isCreditNote(before.voucherType)) {
    if (["amountCents", "netCents", "vatPct", "clientId", "company", "associatedInvoiceId"].some(key => key in changes && String(changes[key] ?? "") !== String(before[key] ?? ""))) throw new HttpError("La nota de crédito ya descontó su importe de la factura: para corregirla, borrala y cargala de nuevo.");
    return;
  }
  if (!before.cae) return;
  const changed = FISCAL_FIELDS.filter(key => key in changes && String(changes[key] ?? "") !== String(before[key] ?? "")
    && !(changes[key] instanceof Date && before[key] instanceof Date && changes[key].getTime() === before[key].getTime()));
  if (changes.status === "anulada" && before.status !== "anulada") throw new HttpError("La factura está emitida en ARCA con CAE: no se anula desde acá. Para anularla hace falta una nota de crédito.");
  if (changed.length) throw new HttpError("La factura ya está emitida en ARCA con CAE: el cliente, la fecha, el número y los importes no se cambian. Para corregirla hace falta una nota de crédito.");
}

/**
 * Una nota de débito o de crédito (pedido V2 de Tesorería, 10/11/2026), como en Compras:
 * - **con referencia** va asociada a una factura (o nota de débito) del mismo
 *   cliente, la misma empresa y la misma letra. La de crédito descuenta de lo
 *   que se debe de esa factura; si es por más, lo que sobra queda a favor del cliente;
 * - **sin referencia** no lleva factura: lleva el período que corrige. La de
 *   crédito queda entera a favor del cliente (`creditCents`) y la de débito, como
 *   una deuda más, pendiente de cobro.
 * Devuelve la factura asociada, o null si no la hay.
 */
export async function checkNote(data: Record<string, unknown>) {
  const withoutReference = data.withoutReference === true;
  const period = { from: data.associatedFrom as Date | undefined, to: data.associatedTo as Date | undefined };
  // Son datos de la pantalla: no se guardan como vienen.
  delete data.withoutReference; delete data.associatedFrom; delete data.associatedTo;
  if (!isNote(data.voucherType)) { delete data.associatedInvoiceId; return null; }
  if (!data.associatedInvoiceId) {
    if (!withoutReference) throw new HttpError(`Elegí a qué factura corresponde la ${voucherLabels[String(data.voucherType)]}, o cargala sin referencia`);
    // El período que corrige: sin dato, del primer día del mes de la nota a su fecha (ARCA no acepta uno que la pase).
    const issue = new Date(data.issueDate as string | Date);
    const from = period.from || new Date(Date.UTC(issue.getUTCFullYear(), issue.getUTCMonth(), 1));
    const to = period.to || issue;
    if (from > to) throw new HttpError("El período que corrige la nota va de una fecha a otra posterior");
    if (to > issue) throw new HttpError("El período que corrige no puede pasar de la fecha de la nota");
    data.associatedPeriod = { from, to };
    if (isCreditNote(data.voucherType)) data.creditCents = Number(data.amountCents || 0);
    return null;
  }
  const associated = await Invoice.findById(data.associatedInvoiceId).lean<Record<string, unknown>>();
  if (!associated) throw new HttpError("La factura asociada no existe");
  if (String(associated.clientId) !== String(data.clientId)) throw new HttpError("La factura asociada es de otro cliente");
  if (companyOf(associated.company).key !== companyOf(data.company).key) throw new HttpError("La factura asociada es de la otra empresa");
  if (baseInvoiceType(associated.voucherType) !== baseInvoiceType(data.voucherType) || isCreditNote(associated.voucherType)) throw new HttpError(`La ${voucherLabels[String(data.voucherType)]} va asociada a una factura o nota de débito de la misma letra`);
  if (VOID_INVOICE_STATUSES.includes(String(associated.status))) throw new HttpError("La factura asociada está anulada o sustituida");
  if (isCreditNote(data.voucherType)) {
    // Descuenta lo que se debe de la factura; lo que sobra queda a favor del cliente.
    const pending = Math.max(0, Number(associated.amountCents || 0) - Number(associated.collectedCents || 0));
    const excess = Math.max(0, Number(data.amountCents || 0) - pending);
    if (excess > 0) data.creditCents = excess; else delete data.creditCents;
  }
  return associated;
}

/** Lo que una nota de crédito descontó de su factura asociada: su importe menos lo que quedó a favor y lo que se aplicó a otras facturas. */
export function creditNoteDirectCents(note: Record<string, unknown>) {
  if (!isCreditNote(note.voucherType) || !note.associatedInvoiceId) return 0;
  const elsewhere = (Array.isArray(note.creditApplications) ? note.creditApplications as Array<{ amountCents?: number }> : []).reduce((total, row) => total + Number(row.amountCents || 0), 0);
  return Math.max(0, Number(note.amountCents || 0) - Number(note.creditCents || 0) - elsewhere);
}

/** Aplica (o, con -1, devuelve) a la factura asociada lo que la nota de crédito le descontó. */
export async function applyCreditNote(note: Record<string, unknown>, sign: 1 | -1) {
  const direct = creditNoteDirectCents(note);
  if (direct) await applyInvoiceCollection(note.associatedInvoiceId, sign * direct);
}

/** Una nota de crédito que ya se aplicó a otras facturas no se anula ni se borra: primero se deshacen esas aplicaciones. */
export function checkCreditNoteFree(note: Record<string, unknown>, action: "anular" | "borrar") {
  if (isCreditNote(note.voucherType) && Array.isArray(note.creditApplications) && note.creditApplications.length) {
    throw new HttpError(`La ${invoiceLabel(note)} tiene saldo aplicado a otras facturas: para ${action}la, primero deshacé esas aplicaciones (botón Saldo a favor de la nota).`);
  }
}
