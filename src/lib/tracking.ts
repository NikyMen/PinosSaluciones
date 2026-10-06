import type { Types } from "mongoose";
import { Client, Collection, Invoice, Quote, Work } from "./models";
import { collectionAllocations } from "./balances";
import { invoiceLabel, VOID_INVOICE_STATUSES, signedAmount } from "./invoice-labels";
import { excludedFromTotals } from "./trash";
import { companyOf, type CompanyKey } from "./companies";

/*
 * El seguimiento de punta a punta: cada cotización aprobada (o con facturas)
 * con su obra, las facturas que se le hicieron y los recibos que las cobraron.
 * Una factura va a la cotización que tiene cargada o, si no, a la de su obra.
 * Las facturas sin cotización se agrupan por obra (o por cliente).
 */

type Lean = Record<string, unknown> & { _id: Types.ObjectId };

export type TrackingInvoice = { _id: string; company: CompanyKey; label: string; issueDate: string | null; amountCents: number; collectedCents: number; status: string };
export type TrackingReceipt = { _id: string; number: string; date: string; amountCents: number };
export type TrackingState = "sin_facturar" | "facturado_parcial" | "por_cobrar" | "completa";
export type TrackingRow = {
  key: string;
  quote: { _id: string; number: string; title: string; status: string; amountCents: number; company: CompanyKey } | null;
  client: { _id: string; name: string } | null;
  works: Array<{ _id: string; code: string; name: string }>;
  invoices: TrackingInvoice[];
  receipts: TrackingReceipt[];
  quotedCents: number; invoicedCents: number; collectedCents: number; balanceCents: number; toInvoiceCents: number;
  /** Certificados aprobados de sus obras, y lo certificado que todavía no se facturó (habilitado para facturar). */
  certifiedCents: number; enabledToInvoiceCents: number;
  /** % facturado y % cobrado sobre lo cotizado, y % cobrado sobre lo facturado. */
  invoicedPct: number | null; collectedPct: number | null; collectedOfInvoicedPct: number | null;
  state: TrackingState;
};

const iso = (value: unknown) => value ? new Date(value as Date).toISOString() : null;

/** Anticipos no aplicados: lo cobrado a cuenta (recibos sin factura), que todavía no se imputó a ninguna. */
export async function unappliedAdvances() {
  const [row] = await Collection.aggregate([
    { $match: { invoiceId: { $in: [null] }, $or: [{ allocations: { $exists: false } }, { allocations: { $size: 0 } }] } },
    { $group: { _id: null, total: { $sum: "$amountCents" }, count: { $sum: 1 } } },
  ]);
  return { cents: Number(row?.total || 0), count: Number(row?.count || 0) };
}

export async function trackingRows(): Promise<TrackingRow[]> {
  const excluded = await excludedFromTotals();
  const [invoices, works, collections] = await Promise.all([
    Invoice.find({ _id: { $nin: excluded.invoices }, status: { $nin: VOID_INVOICE_STATUSES } }).sort({ issueDate: 1 }).lean() as Promise<Lean[]>,
    Work.find({ _id: { $nin: excluded.works } }).select("code name clientId quoteId certificates.amountCents certificates.approved certificates.invoiced").lean() as Promise<Lean[]>,
    Collection.find({}).select("number date amountCents invoiceId allocations").sort({ date: 1 }).lean() as Promise<Lean[]>,
  ]);
  const workById = new Map(works.map(work => [String(work._id), work]));
  const quoteOf = (invoice: Lean) => String(invoice.quoteId || workById.get(String(invoice.workId))?.quoteId || "");
  const invoiceQuoteIds = [...new Set(invoices.map(quoteOf).filter(Boolean))];
  const quotes = await Quote.find({
    _id: { $nin: excluded.quotes }, clientId: { $nin: excluded.clients },
    $or: [{ status: { $in: ["aprobada", "convertida"] } }, { _id: { $in: invoiceQuoteIds } }],
  }).select("number title status amountCents clientId workId company").sort({ updatedAt: -1 }).lean() as Lean[];
  const clients = await Client.find({ _id: { $in: [...quotes.map(quote => quote.clientId), ...invoices.map(invoice => invoice.clientId)] } }).select("name").lean() as Lean[];
  const clientName = new Map(clients.map(client => [String(client._id), String(client.name || "")]));

  // Qué recibos cobraron cada factura, y cuánto.
  const receiptsByInvoice = new Map<string, TrackingReceipt[]>();
  for (const collection of collections) {
    for (const allocation of collectionAllocations(collection)) {
      const list = receiptsByInvoice.get(String(allocation.invoiceId)) || [];
      list.push({ _id: String(collection._id), number: String(collection.number || "Cobro"), date: iso(collection.date) || "", amountCents: allocation.amountCents });
      receiptsByInvoice.set(String(allocation.invoiceId), list);
    }
  }

  const rows = new Map<string, TrackingRow>();
  const client = (id: unknown) => id ? { _id: String(id), name: clientName.get(String(id)) || "Cliente" } : null;
  const workRef = (work: Lean) => ({ _id: String(work._id), code: String(work.code || ""), name: String(work.name || "") });
  for (const quote of quotes) {
    const quoteWorks = works.filter(work => String(work.quoteId || "") === String(quote._id) || String(quote.workId || "") === String(work._id));
    rows.set(`q:${quote._id}`, {
      key: `q:${quote._id}`,
      quote: { _id: String(quote._id), number: String(quote.number || ""), title: String(quote.title || ""), status: String(quote.status || ""), amountCents: Number(quote.amountCents || 0), company: companyOf(quote.company).key },
      client: client(quote.clientId), works: quoteWorks.map(workRef), invoices: [], receipts: [],
      quotedCents: Number(quote.amountCents || 0), invoicedCents: 0, collectedCents: 0, balanceCents: 0, toInvoiceCents: 0,
      certifiedCents: 0, enabledToInvoiceCents: 0, invoicedPct: null, collectedPct: null, collectedOfInvoicedPct: null, state: "sin_facturar",
    });
  }
  for (const invoice of invoices) {
    const quoteId = quoteOf(invoice);
    const work = workById.get(String(invoice.workId || ""));
    const key = quoteId && rows.has(`q:${quoteId}`) ? `q:${quoteId}` : work ? `w:${work._id}` : `c:${invoice.clientId}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, quote: null, client: client(invoice.clientId), works: work ? [workRef(work)] : [], invoices: [], receipts: [], quotedCents: 0, invoicedCents: 0, collectedCents: 0, balanceCents: 0, toInvoiceCents: 0,
        certifiedCents: 0, enabledToInvoiceCents: 0, invoicedPct: null, collectedPct: null, collectedOfInvoicedPct: null, state: "sin_facturar" };
      rows.set(key, row);
    }
    if (work && !row.works.some(existing => existing._id === String(work._id))) row.works.push(workRef(work));
    row.invoices.push({ _id: String(invoice._id), company: companyOf(invoice.company).key, label: invoiceLabel(invoice), issueDate: iso(invoice.issueDate), amountCents: signedAmount(invoice), collectedCents: Number(invoice.collectedCents || 0), status: String(invoice.status || "") });
    for (const receipt of receiptsByInvoice.get(String(invoice._id)) || []) {
      const same = row.receipts.find(existing => existing._id === receipt._id);
      if (same) same.amountCents += receipt.amountCents; else row.receipts.push({ ...receipt });
    }
  }

  return [...rows.values()].map(row => {
    const invoicedCents = row.invoices.reduce((total, invoice) => total + invoice.amountCents, 0);
    const collectedCents = row.invoices.reduce((total, invoice) => total + Math.min(invoice.collectedCents, invoice.amountCents), 0);
    const balanceCents = Math.max(0, invoicedCents - collectedCents);
    const toInvoiceCents = row.quote ? Math.max(0, row.quotedCents - invoicedCents) : 0;
    const state: TrackingState = balanceCents > 0 ? "por_cobrar" : !invoicedCents ? "sin_facturar" : toInvoiceCents > 0 ? "facturado_parcial" : "completa";
    // Certificado: lo aprobado en los certificados de sus obras. Lo aprobado sin facturar es lo habilitado para facturar ya.
    const certificates = row.works.flatMap(work => (workById.get(work._id)?.certificates as Array<{ amountCents?: number; approved?: boolean; invoiced?: boolean }> | undefined) || []).filter(certificate => certificate.approved);
    const certifiedCents = certificates.reduce((total, certificate) => total + Number(certificate.amountCents || 0), 0);
    const enabledToInvoiceCents = certificates.filter(certificate => !certificate.invoiced).reduce((total, certificate) => total + Number(certificate.amountCents || 0), 0);
    const pct = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 1000) / 10 : null;
    return { ...row, invoicedCents, collectedCents, balanceCents, toInvoiceCents, certifiedCents, enabledToInvoiceCents,
      invoicedPct: pct(invoicedCents, row.quotedCents), collectedPct: pct(collectedCents, row.quotedCents), collectedOfInvoicedPct: pct(collectedCents, invoicedCents), state };
  });
}
