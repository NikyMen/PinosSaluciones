import type { Types } from "mongoose";
import { Account, CashAccount, CashMovement, Client, Collection, Expense, Invoice, Payment, Supplier } from "./models";
import { collectionAllocations, collectionLines, collectionRetentions, paymentAllocations, paymentLines } from "./balances";
import { cashMethodLabels, retentionLabels } from "./cash-methods";
import { isCreditNote } from "./invoice-labels";
import { periodOf } from "./period";

/*
 * El extracto por caja (pedido de Administración, anexo de Tesorería v5.1): de
 * una caja o de un rango de códigos (1 a 72), entre dos fechas. Por cada cuenta,
 * el saldo anterior, cada movimiento (Cuenta, Período, Fecha, Detalle, Concepto,
 * Débito y Crédito) y el saldo final. Débito es lo que sale; Crédito, lo que entra.
 *
 * El período es el de la factura: un pago o un cobro de varias facturas se abre
 * en una fila por factura, con su parte. Lo que no tiene factura toma el mes de
 * la fecha.
 */

type Lean = Record<string, unknown> & { _id: Types.ObjectId };
export type StatementRow = { date: string; period: string; detail: string; concept: string; debitCents: number; creditCents: number; source: "caja" | "recibo" | "pago" };
export type StatementAccount = { _id: string; code?: number; name: string; company: string; openingCents: number; rows: StatementRow[]; debitCents: number; creditCents: number; closingCents: number };

const iso = (value: unknown) => new Date(value as Date).toISOString();

/** Reparte un importe entre las facturas (por lo aplicado a cada una), con el resto de los centavos en la última. */
function split(cents: number, parts: Array<{ period: string; weight: number }>) {
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  if (!parts.length || total <= 0) return null;
  let given = 0;
  return parts.map((part, index) => {
    const share = index === parts.length - 1 ? cents - given : Math.round(cents * part.weight / total);
    given += share;
    return { period: part.period, cents: share };
  });
}

export async function cashStatement({ from, to, codeFrom, codeTo }: { from: Date; to: Date; codeFrom?: number; codeTo?: number }): Promise<StatementAccount[]> {
  const byCode = codeFrom || codeTo ? { code: { ...(codeFrom ? { $gte: codeFrom } : {}), ...(codeTo ? { $lte: codeTo } : {}) } } : {};
  const accounts = await CashAccount.find(byCode).sort({ code: 1, name: 1 }).lean<Lean[]>();
  const ids = accounts.map(account => account._id);
  if (!ids.length) return [];
  const [cash, collections, payments] = await Promise.all([
    CashMovement.find({ cashAccountId: { $in: ids }, date: { $lte: to } }).sort({ date: 1, createdAt: 1 }).lean<Lean[]>(),
    Collection.find({ date: { $lte: to }, $or: [{ cashAccountId: { $in: ids } }, { "lines.cashAccountId": { $in: ids } }, { "retentions.cashAccountId": { $in: ids } }] }).sort({ date: 1 }).lean<Lean[]>(),
    Payment.find({ date: { $lte: to }, status: { $nin: ["emitida", "anulada"] }, $or: [{ cashAccountId: { $in: ids } }, { "lines.cashAccountId": { $in: ids } }] }).sort({ date: 1 }).lean<Lean[]>(),
  ]);

  // Los nombres y los períodos de lo que hace falta mostrar.
  const invoiceIds = collections.flatMap(row => collectionAllocations(row).map(allocation => allocation.invoiceId));
  const expenseIds = payments.flatMap(row => paymentAllocations(row).map(allocation => allocation.expenseId));
  const [invoices, expenses, ledger, clients, suppliers] = await Promise.all([
    Invoice.find({ _id: { $in: invoiceIds } }).select("period issueDate").lean<Lean[]>(),
    Expense.find({ _id: { $in: expenseIds } }).select("period issueDate voucherType").lean<Lean[]>(),
    Account.find({ _id: { $in: [...cash, ...collections, ...payments].map(row => row.accountId).filter(Boolean) } }).select("name").lean<Lean[]>(),
    Client.find({ _id: { $in: collections.map(row => row.clientId) } }).select("name").lean<Lean[]>(),
    Supplier.find({ _id: { $in: payments.map(row => row.supplierId).filter(Boolean) } }).select("name").lean<Lean[]>(),
  ]);
  const periodOfDoc = (doc?: Lean) => doc ? String(doc.period || periodOf(doc.issueDate)) : "";
  const invoicePeriod = new Map(invoices.map(doc => [String(doc._id), periodOfDoc(doc)]));
  const expenseById = new Map(expenses.map(doc => [String(doc._id), doc]));
  const concept = new Map(ledger.map(doc => [String(doc._id), String(doc.name || "")]));
  const clientName = new Map(clients.map(doc => [String(doc._id), String(doc.name || "")]));
  const supplierName = new Map(suppliers.map(doc => [String(doc._id), String(doc.name || "")]));

  type Entry = StatementRow & { accountId: string; at: number };
  const entries: Entry[] = [];
  const push = (accountId: unknown, base: Omit<StatementRow, "date" | "period" | "debitCents" | "creditCents"> & { at: Date }, cents: number, direction: "in" | "out", parts: Array<{ period: string; weight: number }>) => {
    if (!accountId || !cents) return;
    const pieces = split(cents, parts) || [{ period: periodOf(base.at), cents }];
    const { at, ...row } = base;
    for (const piece of pieces) entries.push({ ...row, accountId: String(accountId), at: at.getTime(), date: iso(at), period: piece.period, debitCents: direction === "out" ? piece.cents : 0, creditCents: direction === "in" ? piece.cents : 0 });
  };

  for (const movement of cash) {
    push(movement.cashAccountId, { source: "caja", at: new Date(movement.date as Date), detail: [String(movement.description || ""), movement.reference && String(movement.reference)].filter(Boolean).join(" · "), concept: concept.get(String(movement.accountId)) || String(movement.category || "") },
      Number(movement.amountCents || 0), movement.direction === "ingreso" ? "in" : "out", []);
  }
  for (const receipt of collections) {
    const parts = collectionAllocations(receipt).map(allocation => ({ period: invoicePeriod.get(String(allocation.invoiceId)) || periodOf(receipt.date), weight: allocation.amountCents }));
    const head = `Recibo ${String(receipt.number || "")} · ${clientName.get(String(receipt.clientId)) || "Cliente"}`;
    const base = { source: "recibo" as const, at: new Date(receipt.date as Date), concept: concept.get(String(receipt.accountId)) || "" };
    for (const line of collectionLines(receipt)) push(line.cashAccountId, { ...base, detail: [head, cashMethodLabels[line.method] || line.method, line.reference].filter(Boolean).join(" · ") }, line.amountCents, "in", parts);
    for (const retention of collectionRetentions(receipt)) push(retention.cashAccountId, { ...base, detail: [head, `Retención ${retentionLabels[retention.type as keyof typeof retentionLabels] || retention.type}`, retention.jurisdiction, retention.certificateNumber].filter(Boolean).join(" · ") }, retention.amountCents, "in", parts);
  }
  for (const payment of payments) {
    // El período sale de las facturas que paga; las notas de crédito no suman peso.
    const parts = paymentAllocations(payment).flatMap(allocation => {
      const expense = expenseById.get(String(allocation.expenseId));
      return isCreditNote(expense?.voucherType) ? [] : [{ period: periodOfDoc(expense) || periodOf(payment.date), weight: allocation.amountCents }];
    });
    const head = `${String(payment.number || "Pago")} · ${supplierName.get(String(payment.supplierId)) || "Proveedor"}`;
    const base = { source: "pago" as const, at: new Date(payment.date as Date), concept: concept.get(String(payment.accountId)) || "" };
    for (const line of paymentLines(payment)) push(line.cashAccountId, { ...base, detail: [head, cashMethodLabels[line.method] || line.method, line.reference].filter(Boolean).join(" · ") }, line.amountCents, "out", parts);
  }
  entries.sort((a, b) => a.at - b.at);

  return accounts.map(account => {
    const start = account.openingDate ? new Date(account.openingDate as Date).getTime() : -Infinity;
    // Lo de antes de la fecha de corte no cuenta: el saldo inicial ya lo incluye.
    const mine = entries.filter(entry => entry.accountId === String(account._id) && entry.at >= start);
    const before = mine.filter(entry => entry.at < from.getTime());
    const rows: StatementRow[] = mine.filter(entry => entry.at >= from.getTime()).map(entry => ({ date: entry.date, period: entry.period, detail: entry.detail, concept: entry.concept, debitCents: entry.debitCents, creditCents: entry.creditCents, source: entry.source }));
    const openingCents = Number(account.openingBalanceCents || 0) + before.reduce((sum, entry) => sum + entry.creditCents - entry.debitCents, 0);
    const debitCents = rows.reduce((sum, row) => sum + row.debitCents, 0);
    const creditCents = rows.reduce((sum, row) => sum + row.creditCents, 0);
    return { _id: String(account._id), code: account.code as number | undefined, name: String(account.name), company: String(account.company), openingCents, rows, debitCents, creditCents, closingCents: openingCents + creditCents - debitCents };
  });
}
