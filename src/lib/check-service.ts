import { Types } from "mongoose";
import { z } from "zod";
import { CashAccount, Check, Client, Payment, Supplier } from "./models";
import { createCashTransfer } from "./cash-transfer";
import { cashAccountServes } from "./cash-account-kinds";
import { HttpError } from "./api";

/*
 * El circuito de los cheques (anexo de Tesorería v5.1, validado con Administración):
 * - el propio sale con la OP de la cuenta de cheques diferidos de su banco; el
 *   día que el banco lo debita, Tesorería lo busca por número y registra la
 *   "Transferencia de cheque diferido al banco": un pase del banco a esa cuenta;
 * - el de terceros entra por un recibo a Valores al Cobro; se endosa en una OP o
 *   se deposita: un pase de Valores al Cobro al banco.
 */

type Lean = Record<string, unknown> & { _id: Types.ObjectId };
const day = z.string({ error: "Poné la fecha" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Poné la fecha").transform(value => new Date(`${value}T00:00:00.000Z`));
export const debitSchema = z.object({ date: day });
export const depositSchema = z.object({ date: day, bankAccountId: z.string({ error: "Elegí el banco" }).regex(/^[a-f\d]{24}$/i, "Elegí el banco") });

export type CarteraCheck = { _id: string; number: string; bank: string; issuer: string; amountCents: number; dueDate: string; format: string; company: string; client: string };

/** Los cheques de terceros en cartera, para endosar en una OP (y los que ya endosó esa OP, al editarla). */
export async function carteraChecks(paymentId?: string): Promise<CarteraCheck[]> {
  const checks = await Check.find({ direction: "recibido", $or: [{ status: "cartera" }, ...(paymentId ? [{ status: "endosado", paymentId }] : [])] }).sort({ dueDate: 1 }).lean<Lean[]>();
  const [accounts, clients] = await Promise.all([
    CashAccount.find({ _id: { $in: checks.map(check => check.cashAccountId).filter(Boolean) } }).select("company").lean<Lean[]>(),
    Client.find({ _id: { $in: checks.map(check => check.clientId).filter(Boolean) } }).select("name").lean<Lean[]>(),
  ]);
  const company = new Map(accounts.map(account => [String(account._id), String(account.company)]));
  const client = new Map(clients.map(row => [String(row._id), String(row.name || "")]));
  return checks.map(check => ({
    _id: String(check._id), number: String(check.number || ""), bank: String(check.bank || ""), issuer: String(check.issuer || ""),
    amountCents: Number(check.amountCents || 0), dueDate: new Date(check.dueDate as Date).toISOString(), format: String(check.format || "fisico"),
    company: company.get(String(check.cashAccountId)) || "", client: client.get(String(check.clientId)) || "",
  }));
}

async function loadCheck(id: string) {
  const check = await Check.findById(id).lean<Lean>();
  if (!check) throw new HttpError("Cheque no encontrado", 404);
  return check;
}

/**
 * El banco debitó un cheque propio: pase del banco a la cuenta de cheques
 * diferidos, y el cheque queda cobrado con esa fecha. Uno de antes, que salió
 * directo del banco con su OP, se marca cobrado sin mover nada (ya bajó).
 */
export async function debitOwnCheck(id: string, input: z.infer<typeof debitSchema>) {
  const check = await loadCheck(id);
  if (check.direction !== "emitido") throw new HttpError("Sólo se debita un cheque propio");
  if (check.status !== "emitido") throw new HttpError(`El cheque ${String(check.number)} ya está ${String(check.status)}`, 409);
  let transferId: string | undefined;
  if (check.cashAccountId) {
    const deferred = await CashAccount.findById(check.cashAccountId).lean<Lean>();
    if (!deferred?.bankAccountId) throw new HttpError(`La cuenta ${String(deferred?.name || "de cheques diferidos")} no dice de qué banco se debita: completalo en Tesorería › Cajas y cuentas`);
    const payment = check.paymentId ? await Payment.findById(check.paymentId).select("number").lean<Lean>() : null;
    const supplier = check.supplierId ? await Supplier.findById(check.supplierId).select("name").lean<Lean>() : null;
    const transfer = await createCashTransfer({
      date: input.date, from: String(deferred.bankAccountId), to: String(deferred._id), amountCents: Number(check.amountCents || 0),
      description: `Transferencia de cheque diferido al banco · ${check.format === "echeq" ? "e-Cheq" : "Cheque"} ${String(check.number)}${payment ? ` · ${String(payment.number)}` : ""}${supplier ? ` · ${String(supplier.name)}` : ""}`,
      reference: `${check.format === "echeq" ? "e-Cheq" : "Cheque"} ${String(check.number)}`, confirmDuplicate: true,
    });
    transferId = transfer.transferId;
  }
  await Check.updateOne({ _id: check._id }, { $set: { status: "cobrado", settledAt: input.date, ...(transferId ? { transferId } : {}) } });
  return Check.findById(check._id).lean();
}

/** Se deposita un cheque de terceros de la cartera: pase de Valores al Cobro al banco, y el cheque queda depositado. */
export async function depositThirdPartyCheck(id: string, input: z.infer<typeof depositSchema>) {
  const check = await loadCheck(id);
  if (check.direction !== "recibido") throw new HttpError("Sólo se deposita un cheque de terceros");
  if (check.status !== "cartera") throw new HttpError(`El cheque ${String(check.number)} no está en cartera (está ${String(check.status)})`, 409);
  if (!check.cashAccountId) throw new HttpError("El cheque no está en ninguna cuenta de Valores al Cobro: entró antes del circuito nuevo");
  const [from, bank] = await Promise.all([CashAccount.findById(check.cashAccountId).lean<Lean>(), CashAccount.findById(input.bankAccountId).lean<Lean>()]);
  if (!bank) throw new HttpError("El banco elegido no existe");
  if (from && !cashAccountServes(bank.company, from.company) && !cashAccountServes(from.company, bank.company)) throw new HttpError(`${String(bank.name)} es de otra empresa`);
  const transfer = await createCashTransfer({
    date: input.date, from: String(check.cashAccountId), to: input.bankAccountId, amountCents: Number(check.amountCents || 0),
    description: `Depósito de cheque de terceros ${String(check.number)} · ${String(check.bank || "")}`.trim(), reference: `Cheque ${String(check.number)}`, confirmDuplicate: true,
  });
  await Check.updateOne({ _id: check._id }, { $set: { status: "depositado", settledAt: input.date, transferId: transfer.transferId } });
  return Check.findById(check._id).lean();
}
