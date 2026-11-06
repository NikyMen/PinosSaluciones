import { Types } from "mongoose";
import { z } from "zod";
import { Account, CashAccount, Check, Expense, Payment, Purchase, Supplier, Work } from "./models";
import { applyPayment, paymentAllocations, paymentLines } from "./balances";
import { invoiceLabel, isCreditNote } from "./invoice-labels";
import { money } from "./format";
import { companyOf, type CompanyKey } from "./companies";
import { accountChange, checkLedgerAccount, checkWorkForAccount } from "./account-service";
import { prepareCashAccount, resolveCashAccount, type CashAccountDoc } from "./cash-accounts";
import { accountTypesFor, cashMethodLabels, METHODS_NEEDING_ATTACHMENT, OWN_CHECK_METHODS, PAYMENT_METHODS, type PaymentMethod } from "./cash-methods";
import { availableThirdPartyCheck, syncPaymentChecks, type CheckLine, type OwnCheckData } from "./payment-checks";
import { beforeCreate } from "./document-rules";
import { afterPaymentChange } from "./purchase-flow";
import { HttpError } from "./api";
import type { PaymentOrderPdfData } from "./payment-order-pdf";
import type { Session } from "./auth";

/*
 * La orden de pago de Tesorería (reunión con Tesorería, octubre 2026): se elige el
 * proveedor y aparecen sus facturas y notas de débito con saldo, y sus notas de
 * crédito sin descontar. De cada factura se paga el total o una parte; lo que
 * queda sigue pendiente para la próxima OP. Las notas de crédito restan de lo
 * que se paga. La OP lleva el tipo de gasto (la cuenta del plan), la obra si
 * corresponde y de qué caja sale la plata.
 */

const id = z.string().regex(/^[a-f\d]{24}$/i, "ID inválido");
const optionalId = id.or(z.literal("")).optional().transform(value => value || undefined);
const isoDate = (message: string) => z.string({ error: message }).regex(/^\d{4}-\d{2}-\d{2}$/, message);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const upload = z.string().regex(/^\/api\/uploads\/[\w.-]+$/, "Comprobante inválido").or(z.literal("")).optional().transform(value => value || undefined);
const ownCheck = z.object({
  number: z.string().trim().min(1, "Poné el número del cheque").max(40),
  bank: z.string().trim().min(1, "Poné el banco del cheque").max(80),
  dueDate: isoDate("Poné la fecha de cobro del cheque"),
});

/** Un medio de la OP: con qué se paga, de qué caja o cuenta y cuánto. */
const lineSchema = z.object({
  method: z.enum(PAYMENT_METHODS, { error: "Elegí el medio de pago" }),
  cashAccountId: optionalId,
  amountCents: z.coerce.number().int().min(0),
  reference: z.string().trim().max(200).optional().default(""),
  attachment: upload,
  // El cheque o e-Cheq propio que se le da al proveedor.
  check: ownCheck.optional(),
  // El cheque de terceros de la cartera que se le endosa.
  checkId: optionalId,
});

/** Lo que manda la pantalla de la orden de pago. */
export const supplierPaymentSchema = z.object({
  supplierId: id,
  date: isoDate("Poné la fecha de la orden de pago"),
  dueDate: isoDate("Fecha inválida").or(z.literal("")).optional().transform(value => value || undefined),
  // Pagarla ahora o dejarla emitida para pagarla al vencimiento.
  execute: z.boolean().default(true),
  // Los medios. Sin `lines`, uno solo con `method`, `cashAccountId`, `check` y `attachment` (lo que mandaba la pantalla de antes).
  lines: z.array(lineSchema).max(20, "Hasta 20 medios por orden de pago").optional(),
  method: z.enum(PAYMENT_METHODS, { error: "Elegí el medio de pago" }).optional(),
  cashAccountId: optionalId,
  attachment: upload,
  // El tipo de gasto: la cuenta del plan (CC, GGD, GGI, bienes de uso…).
  accountId: z.string({ error: "Elegí el tipo de gasto" }).regex(/^[a-f\d]{24}$/i, "Elegí el tipo de gasto"),
  accountChangeReason: z.string().trim().max(500).optional().default(""),
  workId: optionalId,
  retentionsCents: z.coerce.number().int().min(0).default(0),
  reference: z.string().trim().max(200).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
  check: ownCheck.optional(),
  allocations: z.array(z.object({ expenseId: id, amountCents: z.coerce.number().int().min(0) })).max(200).default([]),
});
export type SupplierPaymentInput = z.infer<typeof supplierPaymentSchema>;

type Lean = Record<string, unknown> & { _id: Types.ObjectId };

export type PendingVoucher = {
  _id: string; label: string; voucherType: string; credit: boolean; company: CompanyKey;
  issueDate: string | null; dueDate: string | null; receiptRef: string; description: string;
  amountCents: number; paidCents: number;
  /** Lo que ya está en otras órdenes de pago emitidas, todavía sin pagar. */ committedCents: number;
  /** Lo que se puede pagar (o descontar, en una nota de crédito) en esta OP. */ balanceCents: number;
  /** Lo que le aplica la OP que se está editando. */ appliedCents: number;
  workId: string; workLabel: string; orderNumber: string;
  /** Otra OP emitida que va a pagarlo, para no pagarlo dos veces. */ notice: string;
};

/**
 * Los comprobantes del proveedor que tienen algo por pagar (o por descontar),
 * el más viejo primero. Lo que está en otra OP emitida no se puede volver a
 * pagar. Al editar una OP, lo que ella ya aplicó vuelve a contar como saldo.
 */
export async function pendingVouchers(supplierId: string, paymentId?: string): Promise<PendingVoucher[]> {
  const payment = paymentId ? await Payment.findById(paymentId).lean<Lean>() : null;
  const applied = new Map(paymentAllocations(payment ?? {}).map(allocation => [String(allocation.expenseId), allocation.amountCents]));
  const selfPaid = Boolean(payment && payment.status !== "emitida" && payment.status !== "anulada");
  const [expenses, emitted] = await Promise.all([
    Expense.find({ supplierId, voucherType: { $ne: null }, status: { $ne: "anulado" } }).sort({ issueDate: 1, createdAt: 1 }).lean<Lean[]>(),
    Payment.find({ supplierId, status: "emitida", ...(paymentId ? { _id: { $ne: paymentId } } : {}) }).select("number expenseId amountCents allocations purchaseId").lean<Lean[]>(),
  ]);
  const committed = new Map<string, { cents: number; numbers: string[] }>();
  // Las OP emitidas contra una OC sin factura (contado, anticipo): cuando se paguen, cubren las facturas de esa OC.
  const orderAdvances = new Map<string, string[]>();
  for (const other of emitted) {
    const allocations = paymentAllocations(other);
    if (!allocations.length && other.purchaseId) orderAdvances.set(String(other.purchaseId), [...orderAdvances.get(String(other.purchaseId)) || [], String(other.number || "")]);
    for (const allocation of allocations) {
      const key = String(allocation.expenseId);
      const current = committed.get(key) || { cents: 0, numbers: [] };
      committed.set(key, { cents: current.cents + allocation.amountCents, numbers: [...current.numbers, String(other.number || "")] });
    }
  }
  const [works, orders] = await Promise.all([
    Work.find({ _id: { $in: expenses.map(expense => expense.workId).filter(Boolean) } }).select("code name").lean<Lean[]>(),
    Purchase.find({ _id: { $in: expenses.map(expense => expense.purchaseId).filter(Boolean) } }).select("number").lean<Lean[]>(),
  ]);
  const workLabel = new Map(works.map(work => [String(work._id), [work.code, work.name].filter(Boolean).join(" · ")]));
  const orderNumber = new Map(orders.map(order => [String(order._id), String(order.number || "")]));
  const iso = (value: unknown) => value ? new Date(value as Date).toISOString() : null;

  return expenses.map(expense => {
    const key = String(expense._id);
    const appliedCents = applied.get(key) || 0;
    const amountCents = Number(expense.amountCents || 0);
    const paidCents = Number(expense.paidCents || 0) - (selfPaid ? appliedCents : 0);
    const other = committed.get(key);
    const advances = expense.purchaseId ? orderAdvances.get(String(expense.purchaseId)) : undefined;
    return {
      _id: key, label: invoiceLabel(expense), voucherType: String(expense.voucherType || ""), credit: isCreditNote(expense.voucherType),
      company: companyOf(expense.company).key, issueDate: iso(expense.issueDate), dueDate: iso(expense.dueDate),
      receiptRef: String(expense.receiptRef || ""), description: String(expense.description || ""),
      amountCents, paidCents, committedCents: other?.cents || 0,
      balanceCents: Math.max(0, amountCents - paidCents - (other?.cents || 0)), appliedCents,
      workId: expense.workId ? String(expense.workId) : "", workLabel: workLabel.get(String(expense.workId)) || "",
      orderNumber: orderNumber.get(String(expense.purchaseId)) || "",
      notice: other ? `En ${other.numbers.join(", ")} (emitida)` : advances ? `Su OC tiene ${advances.join(", ")} emitida` : "",
    };
  }).filter(voucher => voucher.balanceCents > 0 || voucher.appliedCents > 0);
}

/** Crea la orden de pago (o la cambia, con `paymentId`) y mueve el saldo de cada comprobante. */
export async function saveSupplierPayment(input: SupplierPaymentInput, session: Session, paymentId?: string) {
  const before = paymentId ? await Payment.findById(paymentId) : null;
  if (paymentId && !before) throw new HttpError("Orden de pago no encontrada", 404);
  if (before?.status === "anulada") throw new HttpError("La orden de pago está anulada: no se cambia", 409);
  if (!await Supplier.exists({ _id: input.supplierId })) throw new HttpError("Elegí el proveedor");
  await checkLedgerAccount("egreso", input.accountId, "el gasto");
  await checkWorkForAccount(input.accountId, input.workId);
  if (input.workId && !await Work.exists({ _id: input.workId })) throw new HttpError("La obra elegida no existe");

  // El mismo comprobante dos veces es un solo renglón.
  const byExpense = new Map<string, number>();
  for (const allocation of input.allocations) if (allocation.amountCents > 0) byExpense.set(allocation.expenseId, (byExpense.get(allocation.expenseId) || 0) + allocation.amountCents);
  const pending = new Map((await pendingVouchers(input.supplierId, paymentId)).map(voucher => [voucher._id, voucher]));
  let debitCents = 0;
  let creditCents = 0;
  for (const [expenseId, amountCents] of byExpense) {
    const voucher = pending.get(expenseId);
    if (!voucher) throw new HttpError("Uno de los comprobantes no es de este proveedor o ya está pagado");
    if (amountCents > voucher.balanceCents) {
      throw new HttpError(voucher.credit
        ? `La ${voucher.label} tiene ${money(voucher.balanceCents)} para descontar`
        : `A la ${voucher.label} le quedan ${money(voucher.balanceCents)} por pagar${voucher.committedCents ? ` (${money(voucher.committedCents)} ya están en otra OP emitida)` : ""}`);
    }
    if (voucher.credit) creditCents += amountCents; else debitCents += amountCents;
  }
  if (debitCents <= 0) throw new HttpError("Elegí al menos una factura (o nota de débito) para pagar");
  if (creditCents > debitCents) throw new HttpError(`Las notas de crédito (${money(creditCents)}) no pueden pasar de lo que se paga (${money(debitCents)})`);
  // Una OP la paga una sola empresa: la de los comprobantes.
  const companies = new Set([...byExpense.keys()].map(expenseId => pending.get(expenseId)!.company));
  if (companies.size > 1) throw new HttpError("Una orden de pago es de una sola empresa: hacé una para los comprobantes de cada empresa");
  const company = [...companies][0];
  const amountCents = debitCents - creditCents;
  // La empresa no es agente de retención (Administración, encuesta del 31/10/2026): las percepciones del proveedor van en su factura.
  if (input.retentionsCents > 0) throw new HttpError("La orden de pago no lleva retenciones: la empresa no es agente de retención. Las percepciones del proveedor van en su factura");
  const lines = await resolveLines(input, amountCents, company, before);

  // Con todas las facturas de la misma OC, la OP queda atada a ella (y la OC muestra lo pagado).
  const debitIds = [...byExpense.keys()].filter(expenseId => !pending.get(expenseId)!.credit);
  const expenses = await Expense.find({ _id: { $in: debitIds } }).select("purchaseId").lean<Array<{ _id: Types.ObjectId; purchaseId?: Types.ObjectId }>>();
  const orderIds = new Set(expenses.map(expense => String(expense.purchaseId || "")));
  const purchaseId = orderIds.size === 1 && !orderIds.has("") ? expenses[0].purchaseId : undefined;
  const allocations = [...byExpense].map(([expenseId, cents]) => ({ expenseId: new Types.ObjectId(expenseId), amountCents: cents }));
  const wasPaid = Boolean(before && before.status !== "emitida");

  const data: Record<string, unknown> = {
    company, supplierId: new Types.ObjectId(input.supplierId), expenseId: new Types.ObjectId(debitIds[0]), allocations, purchaseId,
    workId: input.workId ? new Types.ObjectId(input.workId) : undefined,
    status: input.execute ? "pagada" : "emitida", date: day(input.date), dueDate: input.dueDate ? day(input.dueDate) : undefined,
    amountCents, retentionsCents: 0,
    // Los medios; arriba, los del primero (las listas y lo de antes leen uno solo).
    lines: lines.filter(line => line.amountCents > 0).map(storedLine),
    method: lines[0]?.method || input.method || "otro",
    cashAccountId: lines[0]?.cashAccountId ? new Types.ObjectId(String(lines[0].cashAccountId)) : undefined, accountId: new Types.ObjectId(input.accountId),
    reference: input.reference || lines[0]?.reference || "", notes: input.notes, attachment: input.attachment || lines.find(line => line.attachment)?.attachment,
    ...(input.execute && !wasPaid ? { paidAt: new Date(), paidByName: session.name } : {}),
  };

  if (!before) {
    // Las reglas de toda OP: número OP-n, la cuenta del plan y la caja del maestro (obligatoria para pagarla).
    await beforeCreate("payments", data, session);
    const payment = await Payment.create(data);
    await attachChecks(payment._id, input.supplierId, lines);
    const saved = await Payment.findById(payment._id).lean<Lean>();
    await applyPayment(saved, 1);
    await afterPaymentChange(null, saved, session);
    return saved!;
  }

  const previous = before.toObject() as Lean;
  const history = await accountChange(previous, { accountId: input.accountId }, input.accountChangeReason, session);
  await prepareCashAccount("payments", data, previous);
  await applyPayment(previous, -1);
  before.set(data);
  // Lo que quedó vacío se borra.
  for (const key of ["purchaseId", "workId", "dueDate", "cashAccountId", "attachment"]) if (data[key] === undefined) before.set(key, undefined);
  if (history) before.set("accountHistory", [...(before.accountHistory || []), history]);
  await before.save();
  await attachChecks(before._id, input.supplierId, lines);
  const saved = (await Payment.findById(before._id).lean<Lean>())!;
  await applyPayment(saved, 1);
  await afterPaymentChange(previous, saved, session);
  return saved;
}

type ResolvedLine = CheckLine & { method: PaymentMethod; account: string; reference: string; attachment?: string };

const storedLine = (line: ResolvedLine) => ({
  method: line.method, cashAccountId: line.cashAccountId ? new Types.ObjectId(String(line.cashAccountId)) : undefined, account: line.account,
  amountCents: line.amountCents, reference: line.reference, attachment: line.attachment,
  checkId: line.checkId ? new Types.ObjectId(String(line.checkId)) : undefined,
});

/**
 * Los medios de la OP, validados: cada uno de una caja o cuenta del tipo que le
 * corresponde y de la empresa de la OP (o de las dos). Para pagarla, tienen que
 * sumar el importe, y la transferencia y el cheque llevan su comprobante. El
 * cheque propio sale de la cuenta de cheques diferidos de su banco (si se elige
 * el banco, se toma la suya); el de terceros, de la cartera.
 */
async function resolveLines(input: SupplierPaymentInput, amountCents: number, company: CompanyKey, before: { _id: unknown; attachment?: unknown; files?: unknown[] } | null): Promise<ResolvedLine[]> {
  const raw = input.lines ?? (input.method || input.cashAccountId ? [{ method: input.method || "transferencia", cashAccountId: input.cashAccountId, amountCents, reference: input.reference, attachment: input.attachment, check: input.check, checkId: undefined }] : []);
  const paying = raw.filter(line => line.amountCents > 0);
  if (input.execute && amountCents > 0) {
    if (!paying.length) throw new HttpError("Elegí con qué se paga: al menos un medio con su importe");
    const total = paying.reduce((sum, line) => sum + line.amountCents, 0);
    if (total !== amountCents) throw new HttpError(`Los medios suman ${money(total)} y la orden de pago es de ${money(amountCents)}: la diferencia es ${money(amountCents - total)}`);
  }
  const hasFiles = Boolean(before?.attachment) || Boolean(before?.files?.length);
  const resolved: ResolvedLine[] = [];
  // Una OP en cero (la nota de crédito cubre todo) igual dice de qué cuenta es.
  for (const line of raw.length && !paying.length ? raw.slice(0, 1) : paying) {
    const label = cashMethodLabels[line.method].toLowerCase();
    let account: CashAccountDoc | null = null;
    if (line.cashAccountId) {
      // Una cuenta que se inactivó después, en una OP que ya la tenía, se acepta.
      const kept = Boolean(before && await Payment.exists({ _id: before._id, $or: [{ cashAccountId: line.cashAccountId }, { "lines.cashAccountId": line.cashAccountId }] }));
      account = await resolveCashAccount(line.cashAccountId, { company, allowInactive: kept });
    }
    let checkId: unknown;
    let ownCheck: OwnCheckData | undefined;
    if (OWN_CHECK_METHODS.has(line.method)) {
      // Se puede elegir el banco: el cheque sale de su cuenta de cheques diferidos.
      if (account && account.type !== "cheques_diferidos") {
        const deferred = await CashAccount.findOne({ type: "cheques_diferidos", bankAccountId: account._id, active: { $ne: false } }).lean<CashAccountDoc>();
        if (!deferred) throw new HttpError(`${account.name} no tiene cuenta de cheques diferidos: dala de alta en Tesorería › Cajas y cuentas (con ese banco) o elegila`);
        account = deferred;
      }
      if (input.execute && !line.check) throw new HttpError(`Poné el número, el banco y la fecha de cobro del ${label}`);
      if (line.check) ownCheck = { ...line.check, format: line.method === "echeq" ? "echeq" : "fisico" };
    } else if (line.method === "cheque_tercero") {
      if (!line.checkId) throw new HttpError("Elegí el cheque de terceros de la cartera");
      const check = await availableThirdPartyCheck(line.checkId, before?._id);
      if (Number(check.amountCents || 0) !== line.amountCents) throw new HttpError(`El cheque ${String(check.number)} es de ${money(Number(check.amountCents || 0))}: se endosa entero`);
      if (!account && check.cashAccountId) account = await resolveCashAccount(check.cashAccountId, { company, allowInactive: true });
      checkId = check._id;
    }
    if (input.execute && amountCents > 0 && !account) throw new HttpError(`Elegí de qué caja o cuenta sale la ${label}`);
    const types = accountTypesFor(line.method, "pago");
    if (account && types && !types.includes(account.type as never)) throw new HttpError(`${account.name} no sirve para pagar con ${label}`);
    if (input.execute && amountCents > 0 && METHODS_NEEDING_ATTACHMENT.has(line.method) && !line.attachment && !hasFiles) throw new HttpError(`Adjuntá el comprobante de la ${label}`);
    resolved.push({ method: line.method, cashAccountId: account?._id, account: account?.name || "", amountCents: line.amountCents, reference: line.reference || "", attachment: line.attachment, ownCheck, checkId });
  }
  return resolved;
}

/** Los cheques de la OP (propios y de terceros) quedan atados a ella, y cada línea, con el suyo. */
async function attachChecks(paymentId: Types.ObjectId, supplierId: string, lines: ResolvedLine[]) {
  const stored = lines.filter(line => line.amountCents > 0);
  const ids = await syncPaymentChecks(paymentId, supplierId, stored);
  const first = ids.find(Boolean);
  await Payment.updateOne({ _id: paymentId }, {
    $set: { lines: stored.map((line, index) => storedLine({ ...line, checkId: ids[index] })), ...(first ? { checkId: first } : {}) },
    ...(first ? {} : { $unset: { checkId: "" } }),
  });
}

const iso = (value: unknown) => value ? new Date(value as Date).toISOString() : undefined;

/** Los datos del PDF de una orden de pago: el proveedor, qué comprobantes paga, cuánto de cada uno y de dónde sale. */
export async function paymentOrderPdfData(paymentId: string): Promise<PaymentOrderPdfData | null> {
  const payment = await Payment.findById(paymentId).lean<Lean>();
  if (!payment) return null;
  const allocations = paymentAllocations(payment);
  const [supplier, order, request, expenses, account, work, check] = await Promise.all([
    payment.supplierId ? Supplier.findById(payment.supplierId).select("name cuit").lean<Lean>() : null,
    payment.purchaseId ? Purchase.findById(payment.purchaseId).select("number").lean<Lean>() : null,
    payment.requestId ? Purchase.findById(payment.requestId).select("number").lean<Lean>() : null,
    Expense.find({ _id: { $in: allocations.map(allocation => allocation.expenseId) } }).select("voucherType number issueDate amountCents").lean<Lean[]>(),
    payment.accountId ? Account.findById(payment.accountId).select("name").lean<Lean>() : null,
    payment.workId ? Work.findById(payment.workId).select("code name").lean<Lean>() : null,
    payment.checkId ? Check.findById(payment.checkId).select("number bank dueDate format").lean<Lean>() : null,
  ]);
  const media = paymentLines(payment);
  const checks = await Check.find({ _id: { $in: media.map(line => line.checkId).filter(Boolean) } }).select("number bank dueDate format direction").lean<Lean[]>();
  const checkById = new Map(checks.map(row => [String(row._id), row]));
  const byId = new Map(expenses.map(expense => [String(expense._id), expense]));
  const lines = allocations.map(allocation => {
    const expense = byId.get(String(allocation.expenseId));
    return {
      label: expense ? invoiceLabel(expense) : "Comprobante", issueDate: iso(expense?.issueDate),
      totalCents: Number(expense?.amountCents || 0), appliedCents: allocation.amountCents, credit: isCreditNote(expense?.voucherType),
    };
  });
  return {
    company: companyOf(payment.company).key, number: String(payment.number || ""), date: iso(payment.date) || new Date().toISOString(), dueDate: iso(payment.dueDate),
    status: String(payment.status || "pagada"),
    supplier: { name: String(supplier?.name || "Proveedor"), cuit: supplier?.cuit ? String(supplier.cuit) : undefined },
    orderNumber: order ? String(order.number) : undefined, requestNumber: request ? String(request.number) : undefined,
    invoiceLabel: lines.length === 1 ? lines[0].label : undefined, lines: lines.length > 1 || lines.some(line => line.appliedCents !== line.totalCents) ? lines : undefined,
    workLabel: work ? [work.code, work.name].filter(Boolean).join(" · ") : undefined,
    amountCents: Number(payment.amountCents || 0), retentionsCents: Number(payment.retentionsCents || 0),
    method: String(payment.method || ""), cashAccount: payment.account ? String(payment.account) : undefined, ledgerAccount: account ? String(account.name) : undefined,
    check: check ? { number: String(check.number || ""), bank: String(check.bank || ""), dueDate: iso(check.dueDate), electronic: check.format === "echeq" } : undefined,
    media: media.map(line => {
      const row = line.checkId ? checkById.get(String(line.checkId)) : undefined;
      const detail = row ? [`N° ${String(row.number || "")}`, String(row.bank || ""), row.dueDate ? `cobro ${new Date(row.dueDate as Date).toISOString().slice(0, 10).split("-").reverse().join("/")}` : ""].filter(Boolean).join(" ") : line.reference ? `Ref. ${line.reference}` : undefined;
      return { method: line.method, account: line.account, amountCents: line.amountCents, detail };
    }),
    reference: payment.reference ? String(payment.reference) : undefined, notes: payment.notes ? String(payment.notes) : undefined,
    paidAt: iso(payment.paidAt), paidByName: payment.paidByName ? String(payment.paidByName) : undefined,
  };
}
