import { Types } from "mongoose";
import { Check } from "./models";
import { HttpError } from "./api";

/*
 * Los cheques de una orden de pago (anexo de Tesorería v5.1):
 * - el propio (cheque o e-Cheq) se crea con la OP, emitido, en la cuenta de
 *   cheques diferidos de su banco; si la OP deja de pagarse con él, se borra,
 *   salvo que el banco ya lo haya debitado;
 * - el de terceros se elige de la cartera (entró por un recibo) y queda
 *   endosado al proveedor; si la OP lo suelta o se anula, vuelve a la cartera.
 */

type Lean = Record<string, unknown> & { _id: Types.ObjectId };
export type OwnCheckData = { number: string; bank: string; dueDate: string; format: "fisico" | "echeq" };
export type CheckLine = { method: string; cashAccountId?: unknown; amountCents: number; ownCheck?: OwnCheckData; checkId?: unknown };

/** Un cheque de terceros que esta OP puede usar: recibido y en cartera, o ya endosado por ella misma. */
export async function availableThirdPartyCheck(checkId: unknown, paymentId?: unknown) {
  const check = await Check.findById(checkId).lean<Lean>();
  if (!check || check.direction !== "recibido") throw new HttpError("El cheque de terceros elegido no existe");
  const mine = paymentId && String(check.paymentId || "") === String(paymentId);
  if (check.status !== "cartera" && !(mine && check.status === "endosado")) throw new HttpError(`El cheque ${String(check.number)} no está en cartera (está ${String(check.status)})`);
  return check;
}

/**
 * Deja los cheques como dicen las líneas de la OP y devuelve el `checkId` de
 * cada línea. Lo que la OP tenía y ya no usa se suelta: el propio sin debitar se
 * borra, el de terceros vuelve a la cartera.
 */
export async function syncPaymentChecks(paymentId: Types.ObjectId, supplierId: unknown, lines: CheckLine[]) {
  const ownBefore = await Check.find({ paymentId, direction: "emitido" }).sort({ createdAt: 1 }).lean<Lean[]>();
  const ownLines = lines.filter(line => line.ownCheck);
  const settled = ownBefore.filter(check => check.status !== "emitido");
  if (settled.length > ownLines.length) throw new HttpError(`El cheque ${String(settled[0].number)} ya se debitó: la OP no puede dejar de pagarse con él`, 409);
  // Primero los ya debitados, así no se tocan.
  const reusable = [...settled, ...ownBefore.filter(check => check.status === "emitido")];

  const ids: Array<Types.ObjectId | undefined> = [];
  const thirdParty = new Set<string>();
  let own = 0;
  for (const line of lines) {
    if (line.ownCheck) {
      const data = {
        direction: "emitido", format: line.ownCheck.format, number: line.ownCheck.number, bank: line.ownCheck.bank, dueDate: new Date(`${line.ownCheck.dueDate}T00:00:00.000Z`),
        amountCents: line.amountCents, supplierId, paymentId, cashAccountId: line.cashAccountId,
      };
      const previous = reusable[own++];
      if (previous) {
        // Uno ya debitado conserva su estado; uno sin debitar sigue emitido.
        await Check.updateOne({ _id: previous._id }, { $set: { ...data, ...(previous.status === "emitido" ? { status: "emitido" } : {}) } });
        ids.push(previous._id);
      } else ids.push((await Check.create({ ...data, status: "emitido" }))._id);
    } else if (line.checkId) {
      const id = new Types.ObjectId(String(line.checkId));
      thirdParty.add(String(id));
      await Check.updateOne({ _id: id }, { $set: { status: "endosado", paymentId, supplierId } });
      ids.push(id);
    } else ids.push(undefined);
  }
  const leftovers = reusable.slice(own).filter(check => check.status === "emitido").map(check => check._id);
  if (leftovers.length) await Check.deleteMany({ _id: { $in: leftovers } });
  await Check.updateMany({ paymentId, direction: "recibido", _id: { $nin: [...thirdParty].map(id => new Types.ObjectId(id)) } }, { $set: { status: "cartera" }, $unset: { paymentId: "", supplierId: "" } });
  return ids;
}

/** Una OP anulada o borrada suelta sus cheques: los de terceros vuelven a la cartera y el propio sin debitar se borra. */
export async function releasePaymentChecks(paymentId: unknown) {
  if (!paymentId) return;
  await Check.updateMany({ paymentId, direction: "recibido", status: "endosado" }, { $set: { status: "cartera" }, $unset: { paymentId: "", supplierId: "" } });
  await Check.deleteMany({ paymentId, direction: "emitido", status: "emitido" });
}
