import type { Types } from "mongoose";
import { CashAccount, CashMovement, Collection, Payment } from "./models";
import { HttpError } from "./api";
import { companyOf } from "./companies";
import { paidByPayment } from "./balances";

/*
 * El maestro de cajas y cuentas bancarias (requerimiento integral v4, 4.1).
 * Cada cobro, pago y movimiento de caja elige una cuenta de acá; ya no se crea
 * una escribiendo un nombre nuevo.
 */

type Lean = Record<string, unknown> & { _id: Types.ObjectId };
export type CashAccountDoc = Lean & { name: string; company: string; active?: boolean; openingBalanceCents?: number; openingDate?: Date };

/** El nombre para comparar: sin mayúsculas, acentos, puntos ni espacios de más. "Bco. Nación  TVP" y "bco nacion tvp" son el mismo. */
export function cashAccountKey(name: unknown) {
  return String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * La cuenta que eligió un movimiento: tiene que existir y estar activa (salvo
 * que el movimiento ya la tuviera, si se edita otra cosa) y ser de la empresa
 * del movimiento, si la tiene. Devuelve su nombre, que se guarda junto.
 */
export async function resolveCashAccount(id: unknown, options: { company?: unknown; allowInactive?: boolean } = {}) {
  if (!id) return null;
  const account = await CashAccount.findById(id).lean<CashAccountDoc>();
  if (!account) throw new HttpError("La caja o cuenta elegida no existe");
  if (account.active === false && !options.allowInactive) throw new HttpError(`La cuenta ${account.name} está inactiva: elegí otra`);
  if (options.company && companyOf(options.company).key !== companyOf(account.company).key) {
    throw new HttpError(`La cuenta ${account.name} es de ${companyOf(account.company).short}: elegí una de ${companyOf(options.company).short}`);
  }
  return account;
}

/**
 * La caja o cuenta de un movimiento (de caja, cobro o pago), antes de guardarlo:
 * valida la elegida y deja su nombre en `account`. `before` es el registro como
 * estaba, en un cambio.
 */
export async function prepareCashAccount(entity: "cash" | "collections" | "payments", data: Record<string, unknown>, before?: Record<string, unknown>) {
  // Una planilla importada trae el nombre: se busca en el maestro, nunca se crea.
  if (!data.cashAccountId && !before && typeof data.account === "string" && data.account.trim()) {
    const named = await CashAccount.findOne({ nameKey: cashAccountKey(data.account) }).select("_id").lean<{ _id: unknown }>();
    if (!named) throw new HttpError(`No existe la caja o cuenta "${data.account}": hay que darla de alta en Tesorería › Cajas y cuentas bancarias`);
    data.cashAccountId = named._id;
  }
  const changed = "cashAccountId" in data && String(data.cashAccountId || "") !== String(before?.cashAccountId || "");
  const merged = { ...before, ...data };
  const required = entity === "cash" ? !before : entity === "collections" ? !before : merged.status === "pagada" && (!before || before.status !== "pagada" || changed);
  if (!merged.cashAccountId) {
    if (required) throw new HttpError(entity === "payments" ? "Elegí de qué caja o cuenta sale el pago" : "Elegí la caja o cuenta");
    return;
  }
  if (!changed && before) return;
  const company = entity === "collections" ? undefined : merged.company;
  const account = await resolveCashAccount(merged.cashAccountId, { company });
  if (!account) return;
  data.account = account.name;
  // Un movimiento de caja sin empresa queda con la de su cuenta.
  if (entity === "cash" && !merged.company) data.company = account.company;
}

/** Antes de guardar una cuenta del maestro: nombre sin repetir y saldo inicial sólo de Gerencia. */
export async function prepareCashAccountRecord(data: Record<string, unknown>, before: Record<string, unknown> | null, role: string) {
  if ("name" in data) {
    const nameKey = cashAccountKey(data.name);
    if (!nameKey) throw new HttpError("Poné el nombre de la cuenta");
    const twin = await CashAccount.findOne({ nameKey, ...(before ? { _id: { $ne: before._id } } : {}) }).select("name").lean<{ name: string }>();
    if (twin) throw new HttpError(`Ya existe la cuenta "${twin.name}": no se puede repetir aunque se escriba distinto`, 409);
    data.nameKey = nameKey;
  }
  const opening = (key: string) => key in data && String(data[key] ?? "") !== String(before?.[key] ?? (key === "openingBalanceCents" ? 0 : ""));
  const openingChanged = before
    ? opening("openingBalanceCents") || (data.openingDate !== undefined && new Date(String(data.openingDate)).getTime() !== new Date(String(before.openingDate || 0)).getTime())
    : Number(data.openingBalanceCents || 0) !== 0;
  if (openingChanged && role !== "gerencia") throw new HttpError("El saldo inicial y la fecha de corte los cambia sólo Gerencia", 403);
}

/** Una cuenta que ya tiene movimientos no se borra: se inactiva. */
export async function checkCashAccountCanBeDeleted(id: unknown) {
  const used = await CashMovement.exists({ cashAccountId: id }) || await Collection.exists({ cashAccountId: id }) || await Payment.exists({ cashAccountId: id });
  if (used) throw new HttpError("Esta cuenta ya tiene movimientos: no se borra, se inactiva (Estado › Inactiva)");
}

/**
 * El saldo de cada cuenta: el inicial más lo que entró y menos lo que salió
 * desde la fecha de corte. Suma los movimientos de caja (con los pases entre
 * cuentas: mueven la plata de lugar), los recibos y los pagos ya hechos.
 */
export async function cashAccountBalances(accounts: CashAccountDoc[]) {
  const ids = accounts.map(account => account._id);
  if (!ids.length) return new Map<string, number>();
  const [cash, collections, payments] = await Promise.all([
    CashMovement.find({ cashAccountId: { $in: ids } }).select("cashAccountId direction amountCents date").lean<Lean[]>(),
    Collection.find({ cashAccountId: { $in: ids } }).select("cashAccountId amountCents date").lean<Lean[]>(),
    Payment.find({ cashAccountId: { $in: ids } }).select("cashAccountId amountCents retentionsCents status date").lean<Lean[]>(),
  ]);
  const byId = new Map(accounts.map(account => [String(account._id), account]));
  const balances = new Map(accounts.map(account => [String(account._id), Number(account.openingBalanceCents || 0)]));
  const add = (row: Lean, cents: number) => {
    const account = byId.get(String(row.cashAccountId));
    if (!account) return;
    if (account.openingDate && row.date && new Date(row.date as Date) < new Date(account.openingDate)) return;
    balances.set(String(account._id), (balances.get(String(account._id)) || 0) + cents);
  };
  for (const movement of cash) add(movement, (movement.direction === "ingreso" ? 1 : -1) * Number(movement.amountCents || 0));
  for (const collection of collections) add(collection, Number(collection.amountCents || 0));
  // Lo que sale de la cuenta es lo pagado menos las retenciones (eso no sale: se le retiene al proveedor).
  for (const payment of payments) { const paid = paidByPayment(payment); if (paid) add(payment, -(paid - Number(payment.retentionsCents || 0))); }
  return balances;
}
