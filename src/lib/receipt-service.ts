import { Types } from "mongoose";
import { z } from "zod";
import { Client, Collection, Invoice, Quote, Work, nextReceiptNumber } from "./models";
import { applyCollection, collectionAllocations } from "./balances";
import { invoiceLabel } from "./invoice-service";
import { money } from "./format";
import { companyOf, type CompanyKey } from "./companies";
import { accountChange, checkLedgerAccount } from "./account-service";
import { VOID_INVOICE_STATUSES } from "./invoice-labels";
import { resolveCashAccount } from "./cash-accounts";
import type { Session } from "./auth";

/*
 * Recibos: un cobro con número propio que se aplica a una o varias facturas
 * del cliente. Cada factura guarda lo cobrado (collectedCents) y su estado; el
 * recibo, cuánto le aplicó a cada una. Editar un recibo deshace lo que había
 * aplicado y aplica lo nuevo.
 */

export class ReceiptError extends Error {}

const id = z.string().regex(/^[a-f\d]{24}$/i, "ID inválido");
/** Lo que manda la pantalla del recibo. */
export const receiptSchema = z.object({
  clientId: id,
  date: z.string({ error: "Poné la fecha del recibo" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Poné la fecha del recibo").transform(value => new Date(`${value}T00:00:00.000Z`)),
  method: z.enum(["transferencia", "efectivo", "cheque", "retencion", "otro"], { error: "Elegí el medio de pago" }),
  // La caja o cuenta bancaria del maestro donde entró la plata: es obligatoria.
  cashAccountId: z.string({ error: "Elegí la caja o cuenta donde entró" }).regex(/^[a-f\d]{24}$/i, "Elegí la caja o cuenta donde entró"),
  // La cuenta del plan (una CI) a la que se imputa el cobro: es obligatoria.
  accountId: z.string({ error: "Elegí la cuenta del plan a la que se imputa el cobro" }).regex(/^[a-f\d]{24}$/i, "Elegí la cuenta del plan a la que se imputa el cobro"),
  accountChangeReason: z.string().trim().max(500).optional().default(""),
  reference: z.string().trim().max(200).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
  amountCents: z.coerce.number().int().min(0).optional(),
  allocations: z.array(z.object({ invoiceId: id, amountCents: z.coerce.number().int().min(0) })).max(200).default([]),
});

export type ReceiptInput = {
  clientId: string; date: Date; method: string; cashAccountId: string; reference?: string; notes?: string;
  accountId: string; accountChangeReason?: string;
  /** Solo cuenta si no se aplica a ninguna factura (un pago a cuenta). */ amountCents?: number;
  allocations: Array<{ invoiceId: string; amountCents: number }>;
};

type Lean = Record<string, unknown> & { _id: Types.ObjectId };

export type PendingInvoice = {
  _id: string; label: string; number: string; company: CompanyKey; issueDate: string | null; dueDate: string | null;
  amountCents: number; collectedCents: number; balanceCents: number; appliedCents: number;
  quoteNumber: string; workLabel: string;
};

/**
 * Las facturas del cliente que tienen algo por cobrar, la más vieja primero.
 * Al editar un recibo, lo que ese recibo ya les aplicó vuelve a contar como saldo
 * (y sus facturas aparecen aunque hayan quedado cobradas).
 */
export async function pendingInvoices(clientId: string, receiptId?: string): Promise<PendingInvoice[]> {
  const receipt = receiptId ? await Collection.findById(receiptId).lean() as Lean | null : null;
  const applied = new Map(collectionAllocations(receipt ?? {}).map(allocation => [String(allocation.invoiceId), allocation.amountCents]));
  const invoices = await Invoice.find({ clientId, status: { $nin: VOID_INVOICE_STATUSES } }).sort({ issueDate: 1, createdAt: 1 }).lean() as Lean[];
  const [quotes, works] = await Promise.all([
    Quote.find({ _id: { $in: invoices.map(invoice => invoice.quoteId).filter(Boolean) } }).select("number").lean() as Promise<Lean[]>,
    Work.find({ _id: { $in: invoices.map(invoice => invoice.workId).filter(Boolean) } }).select("code name").lean() as Promise<Lean[]>,
  ]);
  const quoteNumber = new Map(quotes.map(quote => [String(quote._id), String(quote.number || "")]));
  const workLabel = new Map(works.map(work => [String(work._id), [work.code, work.name].filter(Boolean).join(" · ")]));
  return invoices.map(invoice => {
    const id = String(invoice._id);
    const appliedCents = applied.get(id) || 0;
    const amountCents = Number(invoice.amountCents || 0);
    const collectedCents = Number(invoice.collectedCents || 0) - appliedCents;
    return {
      _id: id, label: invoiceLabel(invoice), number: String(invoice.number || ""), company: companyOf(invoice.company).key,
      issueDate: invoice.issueDate ? new Date(invoice.issueDate as Date).toISOString() : null,
      dueDate: invoice.dueDate ? new Date(invoice.dueDate as Date).toISOString() : null,
      amountCents, collectedCents, balanceCents: Math.max(0, amountCents - collectedCents), appliedCents,
      quoteNumber: quoteNumber.get(String(invoice.quoteId)) || "", workLabel: workLabel.get(String(invoice.workId)) || "",
    };
  }).filter(invoice => invoice.balanceCents > 0 || invoice.appliedCents > 0);
}

/** Crea el recibo (o lo cambia, con `receiptId`) y mueve el saldo de cada factura. */
export async function saveReceipt(input: ReceiptInput, session: Session, receiptId?: string) {
  const before = receiptId ? await Collection.findById(receiptId) : null;
  if (receiptId && !before) throw new ReceiptError("Recibo no encontrado");
  if (!await Client.exists({ _id: input.clientId })) throw new ReceiptError("Elegí el cliente");
  await checkLedgerAccount("ingreso", input.accountId, "el cobro");
  const history = before ? await accountChange(before.toObject(), { accountId: input.accountId }, input.accountChangeReason, session) : null;

  // La misma factura dos veces es un solo renglón.
  const byInvoice = new Map<string, number>();
  for (const allocation of input.allocations) if (allocation.amountCents > 0) byInvoice.set(allocation.invoiceId, (byInvoice.get(allocation.invoiceId) || 0) + allocation.amountCents);
  const pending = new Map((await pendingInvoices(input.clientId, receiptId)).map(invoice => [invoice._id, invoice]));
  for (const [invoiceId, amountCents] of byInvoice) {
    const invoice = pending.get(invoiceId);
    if (!invoice) throw new ReceiptError("Una de las facturas no es de este cliente o ya está cobrada");
    if (amountCents > invoice.balanceCents) throw new ReceiptError(`A la ${invoice.label} le quedan ${money(invoice.balanceCents)} por cobrar`);
  }
  // Un recibo lo emite una sola empresa: la de las facturas que cobra.
  const companies = new Set([...byInvoice.keys()].map(invoiceId => pending.get(invoiceId)!.company));
  if (companies.size > 1) throw new ReceiptError("Un recibo es de una sola empresa: hacé uno para las facturas de Trabajos Verticales Pino y otro para las de Constructora Pino");
  const allocations = [...byInvoice].map(([invoiceId, amountCents]) => ({ invoiceId: new Types.ObjectId(invoiceId), amountCents }));
  const amountCents = allocations.length ? allocations.reduce((total, allocation) => total + allocation.amountCents, 0) : Math.round(Number(input.amountCents || 0));
  if (amountCents <= 0) throw new ReceiptError("Poné cuánto se cobra");
  // La caja o cuenta: del maestro, activa (salvo que el recibo ya la tuviera) y de la empresa de las facturas.
  const keepsAccount = before && String(before.cashAccountId || "") === input.cashAccountId;
  const cashAccount = await resolveCashAccount(input.cashAccountId, { company: [...companies][0], allowInactive: Boolean(keepsAccount) }).catch(error => { throw new ReceiptError(error instanceof Error ? error.message : "Elegí la caja o cuenta"); });

  const payload = {
    clientId: new Types.ObjectId(input.clientId), date: input.date, method: input.method, amountCents,
    cashAccountId: new Types.ObjectId(input.cashAccountId), account: cashAccount?.name || "", accountId: new Types.ObjectId(input.accountId), reference: input.reference || "", notes: input.notes || "",
    allocations, invoiceId: allocations[0]?.invoiceId,
  };
  if (before) {
    await applyCollection(before.toObject(), -1);
    before.set(payload);
    if (history) before.set("accountHistory", [...(before.accountHistory || []), history]);
    if (!allocations.length) before.set("invoiceId", undefined);
    await before.save();
    await applyCollection(before.toObject(), 1);
    return before.toObject();
  }
  const receipt = await Collection.create({ ...payload, number: await nextReceiptNumber(), userName: session.name });
  await applyCollection(receipt.toObject(), 1);
  return receipt.toObject();
}

export type ReceiptPdfData = {
  company: CompanyKey;
  number: string; date: string; method: string; account: string; reference: string; notes: string; userName: string;
  client: { name: string; cuit: string; address: string };
  lines: Array<{ label: string; issueDate: string | null; invoiceCents: number; appliedCents: number; quoteNumber: string }>;
  totalCents: number;
};

/** Lo que lleva el PDF de un recibo: el cliente, las facturas que cancela y cuánto a cada una. */
export async function receiptPdfData(receiptId: string): Promise<ReceiptPdfData | null> {
  const receipt = await Collection.findById(receiptId).lean() as Lean | null;
  if (!receipt) return null;
  const allocations = collectionAllocations(receipt);
  const [client, invoices] = await Promise.all([
    Client.findById(receipt.clientId).select("name cuit address").lean() as Promise<Lean | null>,
    Invoice.find({ _id: { $in: allocations.map(allocation => allocation.invoiceId) } }).lean() as Promise<Lean[]>,
  ]);
  const quotes = await Quote.find({ _id: { $in: invoices.map(invoice => invoice.quoteId).filter(Boolean) } }).select("number").lean() as Lean[];
  const byId = new Map(invoices.map(invoice => [String(invoice._id), invoice]));
  const quoteNumber = new Map(quotes.map(quote => [String(quote._id), String(quote.number || "")]));
  return {
    company: companyOf(invoices[0]?.company).key,
    number: String(receipt.number || String(receipt._id).slice(-6).toUpperCase()),
    date: new Date(receipt.date as Date).toISOString(),
    method: String(receipt.method || ""), account: String(receipt.account || ""), reference: String(receipt.reference || ""),
    notes: String(receipt.notes || ""), userName: String(receipt.userName || ""),
    client: { name: String(client?.name || "Cliente"), cuit: String(client?.cuit || ""), address: String(client?.address || "") },
    lines: allocations.map(allocation => {
      const invoice = byId.get(String(allocation.invoiceId));
      return {
        label: invoice ? invoiceLabel(invoice) : "Factura", issueDate: invoice?.issueDate ? new Date(invoice.issueDate as Date).toISOString() : null,
        invoiceCents: Number(invoice?.amountCents || 0), appliedCents: allocation.amountCents,
        quoteNumber: quoteNumber.get(String(invoice?.quoteId)) || "",
      };
    }),
    totalCents: Number(receipt.amountCents || 0),
  };
}
