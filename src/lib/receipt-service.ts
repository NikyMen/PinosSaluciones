import { Types } from "mongoose";
import { z } from "zod";
import { CashAccount, Check, Client, Collection, Invoice, Quote, Work, nextReceiptNumber } from "./models";
import { applyCollection, collectionAllocations, collectionLines, collectionRetentions } from "./balances";
import { invoiceLabel } from "./invoice-service";
import { money } from "./format";
import { companyOf, type CompanyKey } from "./companies";
import { accountChange, checkLedgerAccount } from "./account-service";
import { VOID_INVOICE_STATUSES } from "./invoice-labels";
import { resolveCashAccount, type CashAccountDoc } from "./cash-accounts";
import { accountTypesFor, cashMethodLabels, COLLECTION_METHODS, OWN_CHECK_METHODS, RETENTION_TYPES, retentionLabels } from "./cash-methods";
import { HttpError } from "./api";
import type { Session } from "./auth";

/*
 * Recibos: un cobro con número propio que se aplica a una o varias facturas
 * del cliente. Cada factura guarda lo cobrado (collectedCents) y su estado; el
 * recibo, cuánto le aplicó a cada una. Editar un recibo deshace lo que había
 * aplicado y aplica lo nuevo.
 *
 * Lo cobrado puede venir en varios medios (transferencia, efectivo, cheque,
 * e-Cheq, tarjeta por posnet), cada uno a su caja o cuenta, más lo que el
 * cliente retuvo (Ganancias, IIBB, IVA, SUSS, otros): todo junto es lo que se
 * aplica a las facturas (anexo de Tesorería v5.1). Un cheque o e-Cheq entra a
 * Valores al Cobro y queda en la cartera, para endosarlo o depositarlo.
 */

export class ReceiptError extends Error {}

const id = z.string().regex(/^[a-f\d]{24}$/i, "ID inválido");
const optionalId = id.or(z.literal("")).optional().transform(value => value || undefined);
const isoDate = (message: string) => z.string({ error: message }).regex(/^\d{4}-\d{2}-\d{2}$/, message);

/** Un medio del recibo: con qué se cobró, a qué caja o cuenta y cuánto. */
const lineSchema = z.object({
  method: z.enum(COLLECTION_METHODS, { error: "Elegí el medio de cobro" }),
  cashAccountId: optionalId,
  amountCents: z.coerce.number().int().min(0),
  reference: z.string().trim().max(200).optional().default(""),
  attachment: z.string().regex(/^\/api\/uploads\/[\w.-]+$/).or(z.literal("")).optional().transform(value => value || undefined),
  // El cheque o e-Cheq recibido: entra a la cartera.
  check: z.object({
    number: z.string().trim().min(1, "Poné el número del cheque").max(40),
    bank: z.string().trim().min(1, "Poné el banco del cheque").max(80),
    dueDate: isoDate("Poné la fecha de cobro del cheque"),
    issuer: z.string().trim().max(160).optional().default(""),
  }).optional(),
});
const retentionSchema = z.object({
  type: z.enum(RETENTION_TYPES, { error: "Elegí el impuesto de la retención" }),
  jurisdiction: z.string().trim().max(80).optional().default(""),
  certificateNumber: z.string().trim().max(60).optional().default(""),
  amountCents: z.coerce.number().int().min(0),
});

/** Lo que manda la pantalla del recibo. */
export const receiptSchema = z.object({
  clientId: id,
  date: z.string({ error: "Poné la fecha del recibo" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Poné la fecha del recibo").transform(value => new Date(`${value}T00:00:00.000Z`)),
  // Los medios. Sin `lines`, uno solo con `method` y `cashAccountId` (lo que mandaba la pantalla de antes).
  lines: z.array(lineSchema).max(20, "Hasta 20 medios por recibo").optional(),
  retentions: z.array(retentionSchema).max(20).optional().default([]),
  method: z.enum([...COLLECTION_METHODS, "retencion"], { error: "Elegí el medio de pago" }).optional(),
  cashAccountId: optionalId,
  // La cuenta del plan (una CI) a la que se imputa el cobro: es obligatoria.
  accountId: z.string({ error: "Elegí la cuenta del plan a la que se imputa el cobro" }).regex(/^[a-f\d]{24}$/i, "Elegí la cuenta del plan a la que se imputa el cobro"),
  accountChangeReason: z.string().trim().max(500).optional().default(""),
  reference: z.string().trim().max(200).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
  amountCents: z.coerce.number().int().min(0).optional(),
  allocations: z.array(z.object({ invoiceId: id, amountCents: z.coerce.number().int().min(0) })).max(200).default([]),
});

export type ReceiptLineInput = z.infer<typeof lineSchema>;
type RawLine = { method: string; cashAccountId?: string; amountCents: number; reference?: string; attachment?: string; check?: { number: string; bank: string; dueDate: string; issuer?: string } };
export type ReceiptInput = {
  clientId: string; date: Date; method?: string; cashAccountId?: string; reference?: string; notes?: string;
  lines?: Array<Partial<ReceiptLineInput> & { method: string; amountCents: number }>;
  retentions?: Array<z.infer<typeof retentionSchema>>;
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
  const company = [...companies][0] as CompanyKey | undefined;
  const retentions = (input.retentions || []).filter(retention => retention.amountCents > 0);
  const retainedCents = retentions.reduce((total, retention) => total + retention.amountCents, 0);
  const appliedCents = allocations.reduce((total, allocation) => total + allocation.amountCents, 0);
  // Sin `lines`, el único medio de la pantalla de antes por lo cobrado.
  const raw: RawLine[] = input.lines ?? (input.cashAccountId ? [{ method: input.method && input.method !== "retencion" ? input.method : "otro", cashAccountId: input.cashAccountId, amountCents: (allocations.length ? appliedCents : Math.round(Number(input.amountCents || 0))) - retainedCents, reference: input.reference }] : []);
  const lines = raw.filter(line => line.amountCents > 0);
  const linesCents = lines.reduce((total, line) => total + line.amountCents, 0);
  const amountCents = allocations.length ? appliedCents : linesCents + retainedCents;
  if (amountCents <= 0) throw new ReceiptError("Poné cuánto se cobra");
  if (!lines.length && !retainedCents) throw new ReceiptError("Elegí con qué se cobró: al menos un medio con su importe y su caja o cuenta");
  if (linesCents + retainedCents !== amountCents) throw new ReceiptError(`Lo cobrado (${money(linesCents)}) más las retenciones (${money(retainedCents)}) tiene que dar lo aplicado a las facturas (${money(amountCents)})`);

  const kept = new Set(before ? [String(before.cashAccountId || ""), ...collectionLines(before.toObject()).map(line => String(line.cashAccountId || ""))] : []);
  const resolved: Array<Omit<RawLine, "cashAccountId"> & { account: string; cashAccountId?: Types.ObjectId }> = [];
  for (const line of lines) {
    const label = cashMethodLabels[line.method].toLowerCase();
    if (!line.cashAccountId) throw new ReceiptError(`Elegí la caja o cuenta donde entró la ${label}`);
    // La caja o cuenta: del maestro, activa (salvo que el recibo ya la tuviera) y de la empresa de las facturas.
    const account = await resolveCashAccount(line.cashAccountId as string, { company, allowInactive: kept.has(line.cashAccountId) }).catch(error => { throw new ReceiptError(error instanceof Error ? error.message : "Elegí la caja o cuenta"); });
    // El tipo de cuenta se controla en lo que manda la pantalla de medios; lo de antes (un solo medio) se acepta como venía.
    const types = input.lines ? accountTypesFor(line.method, "cobro") : null;
    if (account && types && !types.includes(account.type as never)) throw new ReceiptError(`${account.name} no sirve para cobrar con ${label}`);
    if (OWN_CHECK_METHODS.has(line.method) && !line.check) throw new ReceiptError(`Poné el número, el banco y la fecha de cobro del ${label}`);
    resolved.push({ ...line, account: account?.name || "", cashAccountId: account?._id });
  }
  // Las retenciones van a la cuenta de retenciones de la empresa.
  const retentionAccount = retainedCents ? await CashAccount.findOne({ type: "retenciones", company: company || "tvp", active: { $ne: false } }).lean<CashAccountDoc>() : null;
  if (retainedCents && !retentionAccount) throw new ReceiptError(`Falta la cuenta de retenciones de ${companyOf(company).short}: dala de alta en Tesorería › Cajas y cuentas`);

  const payload = {
    clientId: new Types.ObjectId(input.clientId), date: input.date, amountCents,
    lines: resolved.map(line => ({ method: line.method, cashAccountId: line.cashAccountId, account: line.account, amountCents: line.amountCents, reference: line.reference || "", attachment: line.attachment })),
    retentions: retentions.map(retention => ({ ...retention, cashAccountId: retentionAccount?._id, account: retentionAccount?.name || "" })),
    // Arriba, el primer medio (las listas y lo de antes leen uno solo).
    method: resolved[0]?.method || "retencion", cashAccountId: resolved[0]?.cashAccountId || retentionAccount?._id, account: resolved[0]?.account || retentionAccount?.name || "",
    accountId: new Types.ObjectId(input.accountId), reference: input.reference || resolved[0]?.reference || "", notes: input.notes || "",
    allocations, invoiceId: allocations[0]?.invoiceId,
  };
  let saved;
  if (before) {
    await applyCollection(before.toObject(), -1);
    before.set(payload);
    if (history) before.set("accountHistory", [...(before.accountHistory || []), history]);
    if (!allocations.length) before.set("invoiceId", undefined);
    await before.save();
    saved = before.toObject();
  } else saved = (await Collection.create({ ...payload, number: await nextReceiptNumber(), userName: session.name })).toObject();
  await applyCollection(saved, 1);
  await syncReceiptChecks(saved._id, input.clientId, resolved);
  return (await Collection.findById(saved._id).lean())!;
}

/**
 * Los cheques del recibo entran a la cartera (Valores al Cobro), atados al
 * recibo. Al editarlo se actualizan; el que ya se endosó o se depositó no se
 * puede sacar.
 */
async function syncReceiptChecks(collectionId: Types.ObjectId, clientId: string, lines: Array<{ method: string; amountCents: number; cashAccountId?: unknown; check?: { number: string; bank: string; dueDate: string; issuer?: string } }>) {
  const previous = await Check.find({ collectionId }).sort({ createdAt: 1 }).lean<Lean[]>();
  const used = previous.filter(check => check.status !== "cartera");
  const withCheck = lines.filter(line => OWN_CHECK_METHODS.has(line.method) && line.check);
  if (used.length > withCheck.length) throw new ReceiptError(`El cheque ${String(used[0].number)} ya está ${String(used[0].status)}: el recibo no puede dejar de tenerlo`);
  const reusable = [...used, ...previous.filter(check => check.status === "cartera")];
  const ids: unknown[] = [];
  let index = 0;
  for (const line of lines) {
    if (!(OWN_CHECK_METHODS.has(line.method) && line.check)) { ids.push(undefined); continue; }
    const data = {
      direction: "recibido", format: line.method === "echeq" ? "echeq" : "fisico", number: line.check.number, bank: line.check.bank, issuer: line.check.issuer || "",
      dueDate: new Date(`${line.check.dueDate}T00:00:00.000Z`), amountCents: line.amountCents, clientId, collectionId, cashAccountId: line.cashAccountId,
    };
    const reuse = reusable[index++];
    if (reuse) { await Check.updateOne({ _id: reuse._id }, { $set: data }); ids.push(reuse._id); }
    else ids.push((await Check.create({ ...data, status: "cartera" }))._id);
  }
  const leftovers = reusable.slice(index).map(check => check._id);
  if (leftovers.length) await Check.deleteMany({ _id: { $in: leftovers }, status: "cartera" });
  const receipt = await Collection.findById(collectionId).select("lines").lean<{ lines?: Array<Record<string, unknown>> }>();
  if (receipt?.lines?.length) await Collection.updateOne({ _id: collectionId }, { $set: { lines: receipt.lines.map((line, position) => ({ ...line, checkId: ids[position] })) } });
}

/** Antes de borrar un recibo: sus cheques salen de la cartera, salvo que ya se hayan endosado o depositado. */
export async function releaseReceiptChecks(collectionId: unknown, apply: boolean) {
  const used = await Check.findOne({ collectionId, status: { $ne: "cartera" } }).select("number status").lean<Lean>();
  if (used) throw new HttpError(`El cheque ${String(used.number)} del recibo ya está ${String(used.status)}: el recibo no se borra`, 409);
  if (apply) await Check.deleteMany({ collectionId, status: "cartera" });
}

export type ReceiptPdfData = {
  company: CompanyKey;
  number: string; date: string; method: string; account: string; reference: string; notes: string; userName: string;
  /** Con qué se cobró (uno o varios medios) y lo que retuvo el cliente. */
  media?: Array<{ method: string; account: string; amountCents: number; detail?: string }>;
  retentions?: Array<{ label: string; amountCents: number }>;
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
    media: await receiptMedia(receipt),
    retentions: collectionRetentions(receipt).map(retention => ({
      label: [retentionLabels[retention.type as keyof typeof retentionLabels] || retention.type, retention.jurisdiction, retention.certificateNumber && `cert. ${retention.certificateNumber}`].filter(Boolean).join(" · "),
      amountCents: retention.amountCents,
    })),
  };
}

async function receiptMedia(receipt: Lean) {
  const lines = collectionLines(receipt);
  const checks = await Check.find({ _id: { $in: lines.map(line => line.checkId).filter(Boolean) } }).select("number bank").lean<Lean[]>();
  const byId = new Map(checks.map(check => [String(check._id), check]));
  return lines.map(line => {
    const check = line.checkId ? byId.get(String(line.checkId)) : undefined;
    return { method: line.method, account: line.account, amountCents: line.amountCents, detail: check ? `N° ${String(check.number)} ${String(check.bank || "")}`.trim() : line.reference ? `Ref. ${line.reference}` : undefined };
  });
}
