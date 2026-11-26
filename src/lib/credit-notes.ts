import { Types } from "mongoose";
import { Client, Invoice } from "./models";
import { HttpError } from "./api";
import { applyInvoiceCollection } from "./balances";
import { companyOf, type CompanyKey } from "./companies";
import { CREDIT_NOTE_TYPES, invoiceLabel, isCreditNote, VOID_INVOICE_STATUSES } from "./invoice-labels";
import { money } from "./format";
import type { Session } from "./auth";

/*
 * El saldo a favor del cliente (pedido V2 de Tesorería, 10/11/2026). Una nota
 * de crédito sin referencia, o lo que sobra de una con referencia, queda a
 * favor del cliente en la misma nota (`creditCents`). Después se aplica a una
 * factura pendiente del mismo cliente y la misma empresa: baja lo que se debe
 * de la factura (como un cobro) y el saldo de la nota. Cada aplicación queda en
 * la nota (`creditApplications`) y se puede deshacer.
 */

type Lean = Record<string, unknown> & { _id: Types.ObjectId };

export type CreditApplication = { _id: string; invoiceId: string; invoiceLabel: string; amountCents: number; at: string | null; userName: string };
export type ClientCredit = {
  _id: string; label: string; clientId: string; clientName: string; company: CompanyKey; issueDate: string | null;
  amountCents: number; creditCents: number; applications: CreditApplication[];
};

const liveCreditNote = { voucherType: { $in: CREDIT_NOTE_TYPES }, status: { $nin: VOID_INVOICE_STATUSES } };

async function describe(notes: Lean[]): Promise<ClientCredit[]> {
  const applied = notes.flatMap(note => (note.creditApplications as Array<{ invoiceId: unknown }> | undefined) || []).map(row => row.invoiceId);
  const [clients, invoices] = await Promise.all([
    Client.find({ _id: { $in: notes.map(note => note.clientId) } }).select("name").lean<Lean[]>(),
    applied.length ? Invoice.find({ _id: { $in: applied } }).select("voucherType number").lean<Lean[]>() : [],
  ]);
  const clientName = new Map(clients.map(client => [String(client._id), String(client.name || "")]));
  const label = new Map(invoices.map(invoice => [String(invoice._id), invoiceLabel(invoice)]));
  return notes.map(note => ({
    _id: String(note._id), label: invoiceLabel(note), clientId: String(note.clientId), clientName: clientName.get(String(note.clientId)) || "",
    company: companyOf(note.company).key, issueDate: note.issueDate ? new Date(note.issueDate as Date).toISOString() : null,
    amountCents: Number(note.amountCents || 0), creditCents: Number(note.creditCents || 0),
    applications: ((note.creditApplications as Array<Record<string, unknown>> | undefined) || []).map(row => ({
      _id: String(row._id), invoiceId: String(row.invoiceId), invoiceLabel: label.get(String(row.invoiceId)) || "Factura",
      amountCents: Number(row.amountCents || 0), at: row.at ? new Date(row.at as Date).toISOString() : null, userName: String(row.userName || ""),
    })),
  }));
}

/** Las notas de crédito con saldo a favor: las de un cliente o todas, la más vieja primero. */
export async function clientCredits(clientId?: string): Promise<ClientCredit[]> {
  const notes = await Invoice.find({ ...liveCreditNote, creditCents: { $gt: 0 }, ...(clientId ? { clientId } : {}) }).sort({ issueDate: 1, createdAt: 1 }).limit(500).lean<Lean[]>();
  return describe(notes);
}

/** Una nota de crédito con su saldo y sus aplicaciones, para la ventana de Saldo a favor. */
export async function creditNoteDetail(noteId: string): Promise<ClientCredit> {
  const note = await Invoice.findById(noteId).lean<Lean>();
  if (!note || !isCreditNote(note.voucherType)) throw new HttpError("Nota de crédito no encontrada", 404);
  return (await describe([note]))[0];
}

/** Cuántas notas tienen saldo a favor y cuánto suman: el recuadro de Facturas de venta. */
export async function creditSummary() {
  const [row] = await Invoice.aggregate<{ count: number; cents: number }>([
    { $match: { ...liveCreditNote, creditCents: { $gt: 0 } } },
    { $group: { _id: null, count: { $sum: 1 }, cents: { $sum: "$creditCents" } } },
  ]);
  return { creditCount: row?.count || 0, creditCents: row?.cents || 0 };
}

/** El filtro de la lista "A favor de clientes". */
export const creditNotesFilter = { ...liveCreditNote, creditCents: { $gt: 0 } };

/** Aplica saldo a favor de una nota de crédito a una factura pendiente del mismo cliente y la misma empresa. */
export async function applyNoteCredit(noteId: string, input: { invoiceId: string; amountCents: number }, session: Session) {
  const amountCents = Math.round(input.amountCents);
  if (!(amountCents > 0)) throw new HttpError("Poné cuánto se aplica");
  const note = await Invoice.findById(noteId).lean<Lean>();
  if (!note || !isCreditNote(note.voucherType)) throw new HttpError("Nota de crédito no encontrada", 404);
  if (VOID_INVOICE_STATUSES.includes(String(note.status))) throw new HttpError("La nota de crédito está anulada");
  const credit = Number(note.creditCents || 0);
  if (amountCents > credit) throw new HttpError(`A la ${invoiceLabel(note)} le quedan ${money(credit)} a favor`);
  const target = await Invoice.findById(input.invoiceId).lean<Lean>();
  if (!target) throw new HttpError("La factura no existe");
  if (isCreditNote(target.voucherType)) throw new HttpError("El saldo a favor se aplica a una factura o a una nota de débito");
  if (VOID_INVOICE_STATUSES.includes(String(target.status))) throw new HttpError("La factura está anulada o sustituida");
  if (String(target.clientId) !== String(note.clientId)) throw new HttpError("La factura es de otro cliente");
  if (companyOf(target.company).key !== companyOf(note.company).key) throw new HttpError(`La factura es de ${companyOf(target.company).short} y la nota de crédito, de ${companyOf(note.company).short}: el saldo a favor es de cada empresa`);
  const pending = Math.max(0, Number(target.amountCents || 0) - Number(target.collectedCents || 0));
  if (amountCents > pending) throw new HttpError(`A la ${invoiceLabel(target)} le quedan ${money(pending)} por cobrar`);

  // Se descuenta del saldo de la nota sólo si todavía lo tiene: dos personas a la vez no lo usan dos veces.
  const claimed = await Invoice.updateOne({ _id: note._id, creditCents: { $gte: amountCents } }, {
    $inc: { creditCents: -amountCents },
    $push: { creditApplications: { _id: new Types.ObjectId(), invoiceId: target._id, amountCents, at: new Date(), userName: session.name } },
  });
  if (!claimed.modifiedCount) throw new HttpError("El saldo a favor de la nota cambió: revisalo y probá de nuevo", 409);
  await applyInvoiceCollection(target._id, amountCents);
  return creditNoteDetail(noteId);
}

/** Deshace una aplicación: el saldo vuelve a la nota y la factura vuelve a deber ese importe. */
export async function undoNoteCredit(noteId: string, applicationId: string) {
  const note = await Invoice.findById(noteId).lean<Lean>();
  if (!note || !isCreditNote(note.voucherType)) throw new HttpError("Nota de crédito no encontrada", 404);
  const application = ((note.creditApplications as Array<Record<string, unknown>> | undefined) || []).find(row => String(row._id) === applicationId);
  if (!application) throw new HttpError("Esa aplicación ya no está");
  const amountCents = Number(application.amountCents || 0);
  const pulled = await Invoice.updateOne({ _id: note._id, "creditApplications._id": application._id }, { $pull: { creditApplications: { _id: application._id } }, $inc: { creditCents: amountCents } });
  if (!pulled.modifiedCount) throw new HttpError("Esa aplicación ya no está", 409);
  await applyInvoiceCollection(application.invoiceId, -amountCents);
  return creditNoteDetail(noteId);
}

/** Las notas de crédito que descontaron de cada factura (asociadas o aplicadas después), para el PDF del recibo. */
export async function creditNotesByInvoice(invoiceIds: unknown[]) {
  const byInvoice = new Map<string, Array<{ label: string; amountCents: number }>>();
  if (!invoiceIds.length) return byInvoice;
  const notes = await Invoice.find({ ...liveCreditNote, $or: [{ associatedInvoiceId: { $in: invoiceIds } }, { "creditApplications.invoiceId": { $in: invoiceIds } }] }).lean<Lean[]>();
  const wanted = new Set(invoiceIds.map(String));
  const add = (invoiceId: unknown, label: string, amountCents: number) => {
    if (!wanted.has(String(invoiceId)) || amountCents <= 0) return;
    byInvoice.set(String(invoiceId), [...(byInvoice.get(String(invoiceId)) || []), { label, amountCents }]);
  };
  for (const note of notes) {
    const applications = (note.creditApplications as Array<{ invoiceId: unknown; amountCents?: number }> | undefined) || [];
    const elsewhere = applications.reduce((total, row) => total + Number(row.amountCents || 0), 0);
    if (note.associatedInvoiceId) add(note.associatedInvoiceId, invoiceLabel(note), Number(note.amountCents || 0) - Number(note.creditCents || 0) - elsewhere);
    for (const row of applications) add(row.invoiceId, invoiceLabel(note), Number(row.amountCents || 0));
  }
  return byInvoice;
}
