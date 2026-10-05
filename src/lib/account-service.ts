import { isValidObjectId } from "mongoose";
import { Account } from "./models";
import { ACCOUNT_CATALOG, accountDirection } from "./account-catalog";
import { HttpError } from "./api";
import type { Session } from "./auth";

/*
 * La imputación obligatoria al plan de cuentas (punto 11 de la especificación):
 * - ningún ingreso ni egreso se guarda sin cuenta;
 * - la cuenta tiene que existir en el catálogo y estar activa;
 * - un ingreso va a una cuenta CI y un egreso a cualquiera de los otros códigos;
 * - cambiar la cuenta de algo ya guardado pide el motivo y queda en su historia.
 */

type AccountRow = { _id: unknown; code: string; name: string; direction: "ingreso" | "egreso"; active?: boolean };

/** La primera vez que se usa, el catálogo se carga con las cuentas del Anexo A. Las que ya estén no se tocan. */
export async function ensureAccountCatalog() {
  if (await Account.exists({})) return;
  await Account.bulkWrite(ACCOUNT_CATALOG.map(account => ({
    updateOne: { filter: { name: account.name }, update: { $setOnInsert: { ...account, active: true } }, upsert: true },
  })));
}

export async function accountByName(name: string) {
  await ensureAccountCatalog();
  return Account.findOne({ name }).lean<AccountRow>();
}

/**
 * Valida la cuenta de un movimiento y la devuelve. `direction` es para qué se
 * usa: "ingreso" exige una CI y "egreso" cualquier otra.
 */
export async function checkLedgerAccount(direction: "ingreso" | "egreso", accountId: unknown, what = "el movimiento") {
  if (!accountId || !isValidObjectId(String(accountId))) throw new HttpError(`Elegí la cuenta del plan a la que se imputa ${what}`);
  const account = await Account.findById(accountId).lean<AccountRow>();
  if (!account) throw new HttpError("Esa cuenta no está en el plan de cuentas");
  if (account.active === false) throw new HttpError(`La cuenta "${account.name}" está desactivada: elegí otra`);
  if (accountDirection(account.code) !== direction) {
    throw new HttpError(direction === "ingreso"
      ? `Un ingreso va a una cuenta CI; "${account.name}" es de egreso`
      : `Un egreso no puede ir a una cuenta de ingreso (CI): "${account.name}"`);
  }
  return account;
}

/**
 * Antes de guardar un cambio: si la cuenta cambió, pide el motivo y devuelve el
 * renglón para `accountHistory`. Si no cambió, `null`.
 */
export async function accountChange(before: Record<string, unknown>, changes: Record<string, unknown>, reason: unknown, session: Session) {
  if (!("accountId" in changes) || String(changes.accountId || "") === String(before.accountId || "")) return null;
  // Imputar por primera vez algo viejo que no tenía cuenta no es una reclasificación.
  const text = String(reason || "").trim();
  if (before.accountId && !text) throw new HttpError("Contá por qué cambiás la cuenta: queda en el historial");
  const [from, to] = await Promise.all([
    before.accountId ? Account.findById(before.accountId).select("name").lean<{ name?: string }>() : null,
    Account.findById(changes.accountId).select("name").lean<{ name?: string }>(),
  ]);
  return { fromId: before.accountId || undefined, fromName: from?.name || "", toId: changes.accountId, toName: to?.name || "", reason: text || "Primera imputación", userName: session.name, at: new Date() };
}
