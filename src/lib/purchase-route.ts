import type { Types } from "mongoose";
import { Expense, Invoice, Payment, Purchase, Quote, SalesRemito, Supplier, Work } from "./models";
import { companyOf, type CompanyKey } from "./companies";
import { paidByPayment } from "./balances";
import { VOID_INVOICE_STATUSES, invoiceLabel, voucherLabels } from "./invoice-labels";

/*
 * La ruta cerrada de compras (puntos 5 y 7 de la especificación): Cotización u
 * obra → Solicitud → Orden de compra → Recepción en el Central → Factura de
 * compra → Orden de pago → Pago, que se recorre en los dos sentidos. Cada fila
 * es una orden; de ahí se ve de dónde salió y cómo terminó. Además, los
 * documentos que quedaron sueltos (sin vínculo) y el control de tres vías:
 * ordenado, recibido y facturado.
 */

type Lean = Record<string, unknown> & { _id: Types.ObjectId };

/** Diferencia aceptada entre lo ordenado y lo facturado antes de marcarla. La regla fina está pendiente de definir. */
export const THREE_WAY_TOLERANCE = 0.05;

export type RouteRow = {
  _id: string; number: string; stage: string; status: string; company: CompanyKey; priority?: string; neededBy: string | null;
  /** La solicitud de donde salió la orden (SC-n), y cómo van su pago y su recepción. */
  requestNumber: string; paymentStatus: string; receptionStatus: string;
  supplier: string; description: string;
  quote: { _id: string; number: string; title: string } | null; work: { _id: string; code: string; name: string } | null;
  orderedCents: number; receivedAt: string | null; receivedWarehouse: string;
  invoices: Array<{ _id: string; label: string; amountCents: number; paidCents: number; status: string; company: CompanyKey }>;
  payments: Array<{ _id: string; number: string; status: string; amountCents: number; date: string }>;
  invoicedCents: number; paidCents: number; pendingOrdersCents: number;
  /** Lo que el control de tres vías encontró: recibido sin factura, facturado sin recibir, diferencia de importe. */
  alerts: string[];
  step: "solicitud" | "orden" | "recibida" | "facturada" | "pagada" | "cancelada";
};

const iso = (value: unknown) => value ? new Date(value as Date).toISOString() : null;

export async function purchaseRoute(): Promise<{ rows: RouteRow[]; unlinked: Unlinked }> {
  // Una fila por orden de compra y por solicitud que todavía no la tiene: la solicitud con OC se ve en su orden.
  const purchases = await Purchase.find({ $or: [{ stage: { $ne: "solicitud" } }, { orderId: { $exists: false } }] }).sort({ createdAt: -1 }).limit(400).lean<Lean[]>();
  const purchaseIds = purchases.map(purchase => purchase._id);
  const requests = await Purchase.find({ _id: { $in: purchases.map(purchase => purchase.requestId).filter(Boolean) } }).select("number").lean<Lean[]>();
  const requestNumber = new Map(requests.map(request => [String(request._id), String(request.number || "")]));
  const expenses = await Expense.find({ purchaseId: { $in: purchaseIds } }).lean<Lean[]>();
  // Las OP atadas a la orden: las de contado o anticipo (sin factura) y las de sus facturas.
  const payments = await Payment.find({ $or: [{ purchaseId: { $in: purchaseIds } }, { expenseId: { $in: expenses.map(expense => expense._id) } }] }).sort({ date: 1 }).lean<Lean[]>();
  const [suppliers, quotes, works] = await Promise.all([
    Supplier.find({ _id: { $in: purchases.map(purchase => purchase.supplierId).filter(Boolean) } }).select("name").lean<Lean[]>(),
    Quote.find({ _id: { $in: purchases.map(purchase => purchase.quoteId).filter(Boolean) } }).select("number title").lean<Lean[]>(),
    Work.find({ _id: { $in: purchases.map(purchase => purchase.workId).filter(Boolean) } }).select("code name").lean<Lean[]>(),
  ]);
  const supplierName = new Map(suppliers.map(supplier => [String(supplier._id), String(supplier.name || "")]));
  const quoteById = new Map(quotes.map(quote => [String(quote._id), quote]));
  const workById = new Map(works.map(work => [String(work._id), work]));

  const rows = purchases.map((purchase): RouteRow => {
    const own = expenses.filter(expense => String(expense.purchaseId) === String(purchase._id) && expense.status !== "anulado");
    const ownPayments = payments.filter(payment => String(payment.purchaseId || "") === String(purchase._id) || own.some(expense => String(expense._id) === String(payment.expenseId)));
    const ordered = Number(purchase.amountCents || 0);
    const invoiced = own.reduce((total, expense) => total + Number(expense.amountCents || 0), 0);
    const paid = ownPayments.reduce((total, payment) => total + paidByPayment(payment), 0);
    const pendingOrders = ownPayments.filter(payment => payment.status === "emitida").reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
    const received = Boolean(purchase.stockedAt) || purchase.status === "recibida" || purchase.receptionStatus === "recibida";
    const cancelled = purchase.status === "cancelada" || purchase.status === "anulada";
    const alerts: string[] = [];
    if (received && !own.length) alerts.push("Recibida sin factura");
    if (!received && own.length && !cancelled) alerts.push("Facturada sin recepción");
    // El neto de la factura contra lo ordenado (la orden va sin IVA).
    const invoicedNet = own.reduce((total, expense) => total + Number(expense.netCents || expense.amountCents || 0), 0);
    if (own.length && ordered > 0 && Math.abs(invoicedNet - ordered) / ordered > THREE_WAY_TOLERANCE) alerts.push(`Facturado ${invoicedNet > ordered ? "más" : "menos"} que lo ordenado`);
    const step: RouteRow["step"] = cancelled ? "cancelada"
      : (own.length && paid >= invoiced && invoiced > 0) || purchase.paymentStatus === "pagada" && received ? "pagada"
      : own.length ? "facturada" : received ? "recibida" : purchase.stage === "solicitud" ? "solicitud" : "orden";
    const quote = purchase.quoteId ? quoteById.get(String(purchase.quoteId)) : null;
    const work = purchase.workId ? workById.get(String(purchase.workId)) : null;
    return {
      _id: String(purchase._id), number: String(purchase.number || ""), stage: String(purchase.stage || ""), status: String(purchase.status || ""),
      requestNumber: purchase.requestId ? requestNumber.get(String(purchase.requestId)) || "" : "", paymentStatus: String(purchase.paymentStatus || ""), receptionStatus: String(purchase.receptionStatus || ""),
      company: companyOf(purchase.company).key, priority: purchase.priority ? String(purchase.priority) : undefined, neededBy: iso(purchase.neededBy),
      supplier: supplierName.get(String(purchase.supplierId)) || "", description: String(purchase.description || ""),
      quote: quote ? { _id: String(quote._id), number: String(quote.number || ""), title: String(quote.title || "") } : null,
      work: work ? { _id: String(work._id), code: String(work.code || ""), name: String(work.name || "") } : null,
      orderedCents: ordered, receivedAt: iso(purchase.stockedAt || purchase.receivedDate), receivedWarehouse: String(purchase.stockedWarehouse || ""),
      invoices: own.map(expense => ({ _id: String(expense._id), label: `${voucherLabels[String(expense.voucherType)] || "Comprobante"} ${String(expense.number || "")}`.trim(), amountCents: Number(expense.amountCents || 0), paidCents: Number(expense.paidCents || 0), status: String(expense.status || ""), company: companyOf(expense.company).key })),
      payments: ownPayments.map(payment => ({ _id: String(payment._id), number: String(payment.number || "Pago"), status: String(payment.status || "pagada"), amountCents: Number(payment.amountCents || 0), date: iso(payment.date) || "" })),
      invoicedCents: invoiced, paidCents: paid, pendingOrdersCents: pendingOrders, alerts, step,
    };
  });
  return { rows, unlinked: await unlinkedDocuments() };
}

export type Unlinked = {
  purchaseInvoices: Array<{ _id: string; label: string; amountCents: number; date: string | null }>;
  payments: Array<{ _id: string; label: string; amountCents: number; date: string | null }>;
  salesInvoices: Array<{ _id: string; label: string; amountCents: number; date: string | null }>;
  remitosToInvoice: number;
};

/** Lo que quedó suelto: facturas de compra sin orden, pagos sin factura, facturas de venta sin cotización, obra ni remito. */
async function unlinkedDocuments(): Promise<Unlinked> {
  const [purchaseInvoices, payments, salesInvoices, remitosToInvoice] = await Promise.all([
    Expense.find({ voucherType: { $exists: true, $ne: null }, purchaseId: { $exists: false }, status: { $ne: "anulado" } }).sort({ issueDate: -1 }).limit(100).lean<Lean[]>(),
    // Un pago sin factura ni orden de compra: suelto. Uno contra la OC (anticipo, contado) no.
    Payment.find({ expenseId: { $exists: false }, purchaseId: { $exists: false }, status: { $ne: "anulada" } }).sort({ date: -1 }).limit(100).lean<Lean[]>(),
    Invoice.find({ quoteId: { $exists: false }, workId: { $exists: false }, remitoIds: { $in: [null, []] }, status: { $nin: VOID_INVOICE_STATUSES } }).sort({ issueDate: -1 }).limit(100).lean<Lean[]>(),
    SalesRemito.countDocuments({ kind: "salida", status: "pendiente" }),
  ]);
  return {
    purchaseInvoices: purchaseInvoices.map(expense => ({ _id: String(expense._id), label: `${String(expense.number || "Sin número")} · ${String(expense.description || "")}`, amountCents: Number(expense.amountCents || 0), date: iso(expense.issueDate) })),
    payments: payments.map(payment => ({ _id: String(payment._id), label: `${String(payment.number || "Pago")}${payment.reference ? ` · ${String(payment.reference)}` : ""}`, amountCents: Number(payment.amountCents || 0), date: iso(payment.date) })),
    salesInvoices: salesInvoices.map(invoice => ({ _id: String(invoice._id), label: invoiceLabel(invoice), amountCents: Number(invoice.amountCents || 0), date: iso(invoice.issueDate) })),
    remitosToInvoice,
  };
}
