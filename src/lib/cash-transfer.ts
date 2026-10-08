import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CashAccount, CashMovement } from "./models";
import { resolveCashAccount } from "./cash-accounts";
import { accountByName } from "./account-service";
import { TRANSFER_IN_ACCOUNT, TRANSFER_OUT_ACCOUNT } from "./account-catalog";
import { HttpError } from "./api";

/*
 * Un pase de plata entre cuentas propias (de la caja al banco, de un banco a
 * otro). Son dos movimientos atados por el mismo `transferId`: un egreso
 * "CE - Movimiento Entre Cuentas" en la cuenta de origen y un ingreso
 * "CI - MOVIMIENTO ENTRE CUENTAS" en la de destino. No es ni ingreso ni gasto
 * de la empresa: los dos se compensan. Las dos cuentas salen del maestro de
 * cajas y bancos; cada movimiento queda con la empresa de su cuenta.
 */

export const cashTransferSchema = z.object({
  date: z.string({ error: "Poné la fecha" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Poné la fecha").transform(value => new Date(`${value}T00:00:00.000Z`)),
  from: z.string({ error: "Elegí de qué caja o cuenta sale" }).regex(/^[a-f\d]{24}$/i, "Elegí de qué caja o cuenta sale"),
  to: z.string({ error: "Elegí a qué caja o cuenta entra" }).regex(/^[a-f\d]{24}$/i, "Elegí a qué caja o cuenta entra"),
  amountCents: z.coerce.number().int().min(1, "Poné el importe"),
  description: z.string().trim().max(300).optional().default(""),
  reference: z.string().trim().max(200).optional().default(""),
  /** Ya se avisó que parece repetido y se confirma igual. */
  confirmDuplicate: z.boolean().optional().default(false),
});

export type CashTransferInput = z.infer<typeof cashTransferSchema>;

export class DuplicateTransferError extends HttpError {
  constructor(message: string) { super(message, 409); }
}

export async function createCashTransfer(input: CashTransferInput) {
  if (input.from === input.to) throw new HttpError("La cuenta de origen y la de destino tienen que ser distintas");
  const [from, to] = await Promise.all([resolveCashAccount(input.from), resolveCashAccount(input.to)]);
  if (!from || !to) throw new HttpError("Elegí las dos cuentas");
  const [outAccount, inAccount] = await Promise.all([accountByName(TRANSFER_OUT_ACCOUNT), accountByName(TRANSFER_IN_ACCOUNT)]);
  if (!outAccount || !inAccount || outAccount.active === false || inAccount.active === false) {
    throw new HttpError(`Para registrar pases entre cuentas tienen que estar activas "${TRANSFER_OUT_ACCOUNT}" y "${TRANSFER_IN_ACCOUNT}" en el plan de cuentas`);
  }

  // Control de duplicados: el mismo pase (mismo día, mismas cuentas, mismo importe) no se carga dos veces sin querer.
  if (!input.confirmDuplicate) {
    const sameOut = await CashMovement.distinct("transferId", { transferId: { $exists: true }, direction: "egreso", date: input.date, cashAccountId: from._id, amountCents: input.amountCents });
    const twin = sameOut.length > 0 && await CashMovement.exists({ transferId: { $in: sameOut }, direction: "ingreso", cashAccountId: to._id });
    if (twin) throw new DuplicateTransferError("Ya hay un pase igual ese día (mismas cuentas e importe). Si es otro, confirmalo.");
  }

  const transferId = `MEC-${randomUUID().slice(0, 8).toUpperCase()}`;
  const detail = input.description ? ` · ${input.description}` : "";
  const common = { date: input.date, amountCents: input.amountCents, reference: input.reference || transferId, transferId, description: `Pase ${from.name} → ${to.name}${detail}` };
  const [out, into] = await CashMovement.create([
    { ...common, direction: "egreso", cashAccountId: from._id, account: from.name, company: from.company, accountId: outAccount._id },
    { ...common, direction: "ingreso", cashAccountId: to._id, account: to.name, company: to.company, accountId: inAccount._id },
  ]);
  return { transferId, out: out.toObject(), into: into.toObject() };
}

/** Las cajas y cuentas bancarias activas del maestro. */
export async function knownCashAccounts() {
  return CashAccount.find({ active: { $ne: false } }).select("name company type currency").sort({ name: 1 }).lean();
}
