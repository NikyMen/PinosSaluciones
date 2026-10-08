import type { Types } from "mongoose";
import { Invoice, Quote, SalesRemito, Work } from "./models";
import { HttpError } from "./api";
import { money } from "./format";
import { isCreditNote, invoiceLabel, VOID_INVOICE_STATUSES } from "./invoice-labels";
import { quoteNetCents } from "./net-amounts";
import { billingTolerance, invoiceNetCents, quoteBilling, type BillingInvoice, type QuoteAdjustment } from "./quote-billing";
import { invoiceLinesNetCents, remitoPendingCents, type RemitoLike } from "./remito-billing";
import { invoiceRemitoLines } from "./sales-remitos";
import type { Session } from "./auth";

/*
 * La facturación de cada cotización contra la base: qué facturas la aplican,
 * qué certificados y remitos la habilitan, y el control de que una factura nueva
 * no pase de lo disponible (requerimiento integral v4, punto 4.3).
 */

type Lean = Record<string, unknown> & { _id: Types.ObjectId };
type QuoteDoc = Lean & { number?: string; netCents?: number; amountCents?: number; adjustments?: QuoteAdjustment[] };
type CertificateRow = { _id?: Types.ObjectId; number?: string; amountCents?: number; approved?: boolean; invoiced?: boolean };

/** Las facturas de una cotización: las que la tienen cargada y las de sus obras que no tienen otra. */
async function invoicesOfQuote(quoteId: unknown, workIds: unknown[], exclude: unknown[] = []) {
  return Invoice.find({
    _id: { $nin: exclude }, status: { $nin: VOID_INVOICE_STATUSES },
    $or: [{ quoteId }, { quoteId: { $exists: false }, workId: { $in: workIds } }, { quoteId: null, workId: { $in: workIds } }],
  }).sort({ issueDate: 1 }).lean<Lean[]>();
}

/** Lo que la cotización ya tiene listo para facturar: certificados aprobados sin facturar y remitos pendientes. */
function enabledSources(works: Array<{ certificates?: CertificateRow[] }>, remitos: Lean[]) {
  const certificates = works.flatMap(work => work.certificates || []).filter(certificate => certificate.approved && !certificate.invoiced);
  return certificates.reduce((total, certificate) => total + Number(certificate.amountCents || 0), 0)
    + remitos.reduce((total, remito) => total + remitoPendingCents(remito as RemitoLike), 0);
}

export async function loadQuoteBilling(quoteId: unknown, options: { excludeInvoiceIds?: unknown[] } = {}) {
  const quote = await Quote.findById(quoteId).select("number title netCents amountCents items overheads cascade adjustments status company clientId").lean<QuoteDoc>();
  if (!quote) return null;
  const works = await Work.find({ quoteId: quote._id }).select("code name certificates").lean<Array<Lean & { code?: string; name?: string; certificates?: CertificateRow[] }>>();
  const [invoices, remitos] = await Promise.all([
    invoicesOfQuote(quote._id, works.map(work => work._id), options.excludeInvoiceIds),
    SalesRemito.find({ quoteId: quote._id, kind: "salida", status: { $in: ["pendiente", "parcial"] } }).lean<Lean[]>(),
  ]);
  const billing = quoteBilling({ netCents: quoteNetCents(quote as never), adjustments: quote.adjustments, invoices: invoices as BillingInvoice[], enabledSourcesCents: enabledSources(works, remitos) });
  return { quote, works, invoices, remitos, billing };
}

/**
 * Antes de guardar una factura nueva: no puede pasar de lo que queda por
 * facturar de su cotización, de su certificado ni de sus remitos. Gerencia la
 * puede autorizar igual con un motivo, que queda en el historial de la cotización.
 */
export async function checkInvoiceExcess(data: Record<string, unknown>, session: Session) {
  const reason = String(data.excessReason || "").trim();
  delete data.excessReason;
  if (isCreditNote(data.voucherType) || VOID_INVOICE_STATUSES.includes(String(data.status))) return;
  const net = invoiceNetCents(data);
  if (net <= 0) return;
  const problems: string[] = [];
  let quoteDoc: QuoteDoc | null = null;

  if (data.quoteId) {
    // Una fiscal que sustituye una X no se cuenta dos veces: la X sale de la cuenta.
    const loaded = await loadQuoteBilling(data.quoteId, { excludeInvoiceIds: data.replacesId ? [data.replacesId] : [] });
    if (loaded) {
      quoteDoc = loaded.quote;
      const { billing } = loaded;
      if (net > billing.pendingCents + billingTolerance(billing.currentCents)) {
        problems.push(`De la cotización ${loaded.quote.number} quedan ${money(billing.pendingCents)} netos por facturar (vigente ${money(billing.currentCents)}, facturado ${money(billing.invoicedCents)}) y esta factura es de ${money(net)} netos`);
      }
    }
  }
  if (data.workId && (data.certificateId || data.certificateNumber)) {
    const work = await Work.findById(data.workId).select("certificates").lean<{ certificates?: CertificateRow[] }>();
    const certificate = work?.certificates?.find(item => (data.certificateId && String(item._id) === String(data.certificateId)) || (!data.certificateId && String(item.number) === String(data.certificateNumber)));
    const certificateNet = Number(certificate?.amountCents || 0);
    if (certificate && net > certificateNet + billingTolerance(certificateNet)) problems.push(`El certificado ${certificate.number} es de ${money(certificateNet)} netos y esta factura es de ${money(net)} netos`);
  }
  if (Array.isArray(data.remitoIds) && data.remitoIds.length && !data.replacesId) {
    const remitos = await SalesRemito.find({ _id: { $in: data.remitoIds } }).lean<Array<Lean & RemitoLike>>();
    // Lo que valen las cantidades elegidas de cada renglón (o todo lo pendiente, si no se eligieron).
    const lines = invoiceRemitoLines(data);
    const remitoNet = lines.length ? invoiceLinesNetCents(remitos, lines) : remitos.reduce((total, remito) => total + remitoPendingCents(remito), 0);
    if (net > remitoNet + billingTolerance(remitoNet)) problems.push(`Lo elegido de los remitos suma ${money(remitoNet)} netos y esta factura es de ${money(net)} netos`);
  }
  if (!problems.length) return;

  if (session.role !== "gerencia" || reason.length < 3) {
    throw new HttpError(`${problems.join(". ")}. Gerencia la puede autorizar con un motivo.`, 409, { excess: true });
  }
  if (quoteDoc) await Quote.updateOne({ _id: quoteDoc._id }, { $push: { history: { action: "Factura en exceso autorizada", note: `${invoiceLabel(data)}: ${reason}`, at: new Date(), userId: session.userId, userName: session.name } } });
  data.excessApproval = { reason, userName: session.name, at: new Date() };
}
