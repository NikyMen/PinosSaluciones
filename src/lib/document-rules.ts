import { HttpError } from "./api";
import { accountChange, checkLedgerAccount } from "./account-service";
import { accountDirection } from "./account-catalog";
import { Invoice, Purchase, Work } from "./models";
import { VOID_INVOICE_STATUSES } from "./invoice-labels";
import { money } from "./format";
import { checkVoucherEnabled, takeInternalNumber } from "./voucher-books";
import { companyOf } from "./companies";
import { nextPaymentOrderNumber } from "./balances";
import type { Entity } from "./constants";
import type { Session } from "./auth";

/*
 * Las reglas de los comprobantes y de la imputación al plan de cuentas que
 * corren antes de guardar, en el alta y en los cambios de la API genérica de
 * registros. Lo que es propio de un módulo (recibos, cobros) va en su servicio.
 */

/** Para qué se usa la cuenta de cada módulo: un ingreso (CI) o un egreso. */
function ledgerDirection(entity: Entity, record: Record<string, unknown>): "ingreso" | "egreso" | null {
  if (entity === "cash") return record.direction === "ingreso" ? "ingreso" : "egreso";
  if (entity === "payments" || entity === "expenses") return "egreso";
  if (entity === "collections") return "ingreso";
  return null;
}

/** Un ingreso o un egreso de plata no se guarda sin cuenta. Una factura de compra la lleva si se la imputa. */
const ledgerRequired = new Set<Entity>(["cash", "payments", "collections"]);

export async function beforeCreate(entity: Entity, data: Record<string, unknown>) {
  delete data.accountChangeReason;
  if (entity === "accounts") data.direction = accountDirection(data.code);

  const direction = ledgerDirection(entity, data);
  if (direction && (ledgerRequired.has(entity) || data.accountId)) await checkLedgerAccount(direction, data.accountId);

  if (entity === "payments" && !data.number) data.number = await nextPaymentOrderNumber();
  if (entity === "expenses") await prepareExpense(data);
  if (entity === "invoices") {
    const company = companyOf(data.company).key;
    await checkVoucherEnabled(company, "venta", data.voucherType);
    // La X es interna: el número sale de su talonario, nunca se tipea.
    if (data.voucherType === "factura_x") data.number = await takeInternalNumber(company, String(data.pointOfSale || "0001"));
    else if (!String(data.number || "").trim()) throw new HttpError("Poné el número de la factura, como salió de Tango");
  }
}

/** En un cambio: valida la cuenta nueva y, si cambió, guarda quién, cuándo, de cuál a cuál y por qué. */
export async function beforeUpdate(entity: Entity, before: Record<string, unknown>, changes: Record<string, unknown>, session: Session) {
  const reason = changes.accountChangeReason;
  delete changes.accountChangeReason;
  if (entity === "accounts" && changes.code) changes.direction = accountDirection(changes.code);

  const merged = { ...before, ...changes };
  const direction = ledgerDirection(entity, merged);
  const touched = "accountId" in changes || (entity === "cash" && "direction" in changes);
  if (direction && touched && (ledgerRequired.has(entity) || merged.accountId)) await checkLedgerAccount(direction, merged.accountId);
  const history = direction ? await accountChange(before, changes, reason, session) : null;

  if (entity === "expenses") await prepareExpense(changes, before);
  if (entity === "works" && changes.status === "cerrada" && before.status !== "cerrada") await checkWorkCanClose(String(before._id));
  if (entity === "invoices") {
    if ("voucherType" in changes || "company" in changes) await checkVoucherEnabled(companyOf(merged.company).key, "venta", merged.voucherType);
    // Un número interno no se cambia a mano, ni una fiscal pasa a X (ni al revés) después de emitida.
    if ("voucherType" in changes && (changes.voucherType === "factura_x") !== (before.voucherType === "factura_x")) {
      throw new HttpError("Una factura no cambia entre fiscal y X: para reemplazar una X por una fiscal usá Sustituir");
    }
    if (before.voucherType === "factura_x") delete changes.number;
    // Los remitos se atan al crear la factura (o al sustituir una X); después no se cambian a mano.
    delete changes.remitoIds;
    delete changes.replacesId;
  }
  return history ? { $push: { accountHistory: history } } : {};
}

/**
 * Una factura de compra: el tipo tiene que estar habilitado para la empresa
 * que compra, el IVA sale del neto y, si viene de una orden de compra, hereda
 * su empresa, su proveedor y su obra.
 */
async function prepareExpense(data: Record<string, unknown>, before: Record<string, unknown> = {}) {
  const merged = { ...before, ...data };
  if (data.purchaseId) {
    const purchase = await Purchase.findById(data.purchaseId).select("company supplierId workId").lean<{ company?: string; supplierId?: unknown; workId?: unknown }>();
    if (!purchase) throw new HttpError("La orden de compra elegida no existe");
    if (!merged.company && purchase.company) data.company = purchase.company;
    if (!merged.supplierId && purchase.supplierId) data.supplierId = purchase.supplierId;
    if (!merged.workId && purchase.workId) data.workId = purchase.workId;
  }
  const company = data.company ?? before.company;
  if (merged.voucherType) {
    if (!company) data.company = "tvp";
    if ("voucherType" in data || "company" in data) await checkVoucherEnabled(companyOf(data.company ?? company).key, "compra", merged.voucherType);
  }
  const net = Number(merged.netCents || 0);
  if (("netCents" in data || "vatPct" in data) && net > 0) {
    // La C y la X no discriminan IVA.
    const pct = merged.voucherType === "factura_a" ? Number(merged.vatPct ?? 21) : 0;
    const vat = Math.round(net * pct / 100);
    Object.assign(data, { vatPct: pct, vatCents: vat, amountCents: net + vat });
  }
}

/**
 * Una obra se cierra cuando todo está conciliado: no le quedan certificados
 * aprobados sin facturar ni facturas sin cobrar. Antes de eso es "Finalizada".
 */
async function checkWorkCanClose(workId: string) {
  const [work, invoices] = await Promise.all([
    Work.findById(workId).select("certificates").lean<{ certificates?: Array<{ number?: string; approved?: boolean; invoiced?: boolean }> }>(),
    Invoice.find({ workId, status: { $nin: VOID_INVOICE_STATUSES } }).select("amountCents collectedCents").lean<Array<{ amountCents?: number; collectedCents?: number }>>(),
  ]);
  const pendingCertificates = (work?.certificates || []).filter(certificate => certificate.approved && !certificate.invoiced);
  if (pendingCertificates.length) throw new HttpError(`No se puede cerrar: hay certificados aprobados sin facturar (${pendingCertificates.map(certificate => certificate.number).join(", ")}). Mientras tanto queda Finalizada.`);
  const toCollect = invoices.reduce((total, invoice) => total + Math.max(0, Number(invoice.amountCents || 0) - Number(invoice.collectedCents || 0)), 0);
  if (toCollect > 0) throw new HttpError(`No se puede cerrar: quedan ${money(toCollect)} facturados sin cobrar. Mientras tanto queda Finalizada.`);
}
