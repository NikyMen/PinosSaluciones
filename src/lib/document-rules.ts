import { HttpError } from "./api";
import { periodOf } from "./period";
import { accountChange, checkLedgerAccount, checkWorkForAccount, worklessAccount } from "./account-service";
import { accountDirection } from "./account-catalog";
import { Expense, Invoice, Payment, Purchase, PurchaseReceipt, Work } from "./models";
import { baseInvoiceType, isCreditNote, isNote, VOID_INVOICE_STATUSES, voucherLabels } from "./invoice-labels";
import { PURCHASE_TAX_PCT_KEYS, storedPurchaseTaxes, VOUCHER_TAX_CENTS_KEYS, voucherTaxFields } from "./purchase-taxes";
import { money } from "./format";
import { checkVoucherEnabled, takeInternalNumber } from "./voucher-books";
import { companyOf } from "./companies";
import { nextPaymentOrderNumber } from "./balances";
import { netFromGross } from "./net-amounts";
import { prepareCashAccount, prepareCashAccountRecord } from "./cash-accounts";
import { checkExpenseLimit, checkPurchaseChanges, preparePaymentOrder, preparePurchaseAmounts, preparePurchaseQuote, prepareNewRequest } from "./purchase-flow";
import type { Entity } from "./constants";
import type { Session } from "./auth";
import { prepareWorkChanges } from "./work-status";

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

export async function beforeCreate(entity: Entity, data: Record<string, unknown>, session?: Session) {
  if (entity === "works") prepareWorkChanges(data);
  delete data.accountChangeReason;
  if (entity === "accounts") data.direction = accountDirection(data.code);

  const direction = ledgerDirection(entity, data);
  if (direction && (ledgerRequired.has(entity) || data.accountId)) await checkLedgerAccount(direction, data.accountId);

  if (entity === "payments" && !data.number) data.number = await nextPaymentOrderNumber();
  // La OP que paga una factura de una OC queda atada también a la OC.
  if (entity === "payments") await preparePaymentOrder(data);
  if (entity === "payments") await checkWorkForAccount(data.accountId, data.workId);
  // Toda compra nueva es una solicitud en borrador (SC-n): la OC nace cuando se autoriza.
  if (entity === "purchases" && session) await prepareNewRequest(data, session);
  // El total de la solicitud sale del neto y los impuestos.
  if (entity === "purchases") preparePurchaseAmounts(data);
  if (entity === "purchases") await preparePurchaseQuote(data);
  if (entity === "expenses") await prepareExpense(data);
  if (entity === "expenses" && session) await checkExpenseLimit(data, {}, session.role);
  prepareNetAmounts(entity, data);
  // La caja o cuenta sale del maestro: no se crea escribiendo un nombre.
  if (entity === "cash" || entity === "collections" || entity === "payments") await prepareCashAccount(entity, data);
  if (entity === "cashAccounts") await prepareCashAccountRecord(data, null, session?.role || "");
  if (entity === "invoices") {
    const company = companyOf(data.company).key;
    await checkVoucherEnabled(company, "venta", data.voucherType);
    // La X es interna: el número sale de su talonario, nunca se tipea.
    if (data.voucherType === "factura_x") data.number = await takeInternalNumber(company, String(data.pointOfSale || "0001"));
    // Una A o B que se emite en ARCA recibe el número de ARCA; la que viene de Tango trae el suyo.
    else if (data.arcaEmit !== true && !String(data.number || "").trim()) throw new HttpError("Poné el número de la factura, como salió de Tango");
  }
}

/** En un cambio: valida la cuenta nueva y, si cambió, guarda quién, cuándo, de cuál a cuál y por qué. */
export async function beforeUpdate(entity: Entity, before: Record<string, unknown>, changes: Record<string, unknown>, session: Session) {
  if (entity === "works") prepareWorkChanges(changes, before);
  const reason = changes.accountChangeReason;
  delete changes.accountChangeReason;
  if (entity === "accounts" && changes.code) changes.direction = accountDirection(changes.code);

  const merged = { ...before, ...changes };
  const direction = ledgerDirection(entity, merged);
  const touched = "accountId" in changes || (entity === "cash" && "direction" in changes);
  if (direction && touched && (ledgerRequired.has(entity) || merged.accountId)) await checkLedgerAccount(direction, merged.accountId);
  const history = direction ? await accountChange(before, changes, reason, session) : null;

  // Si cambia la fecha y el período era el de la fecha, el período la sigue; uno puesto a mano queda.
  if ((entity === "expenses" || entity === "invoices") && "issueDate" in changes && !changes.period && (!before.period || before.period === periodOf(before.issueDate))) changes.period = periodOf(changes.issueDate);
  if (entity === "expenses") await checkPaidExpenseChanges(before, changes);
  if (entity === "expenses") await prepareExpense(changes, before);
  if (entity === "expenses") await checkExpenseLimit(changes, before, session.role);
  // Una solicitud emitida queda en sólo lectura; una orden, salvo la entrega y las notas.
  if (entity === "purchases") checkPurchaseChanges(before, changes);
  if (entity === "purchases") preparePurchaseAmounts(changes, before);
  if (entity === "purchases") await preparePurchaseQuote(changes, before);
  if (entity === "payments") await preparePaymentOrder(changes, before);
  if (entity === "payments") {
    // Una OP de varias facturas se cambia desde su pantalla: acá sólo el estado, la caja, la cuenta y los datos sueltos.
    if (((Array.isArray(before.allocations) && before.allocations.length) || Number(before.onAccountCents || 0) > 0) && ["amountCents", "expenseId", "supplierId", "company", "onAccountCents"].some(key => key in changes && String(changes[key] ?? "") !== String(before[key] ?? ""))) {
      throw new HttpError("Esta orden de pago aplica varios comprobantes: el importe, el proveedor y las facturas se cambian desde Editar");
    }
    if ("accountId" in changes || "workId" in changes) await checkWorkForAccount(merged.accountId, merged.workId);
  }
  prepareNetAmounts(entity, changes, before);
  if (entity === "cash" || entity === "collections" || entity === "payments") await prepareCashAccount(entity, changes, before);
  if (entity === "cashAccounts") await prepareCashAccountRecord(changes, before, session.role);
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
 * El neto de una cotización cargada a mano y el de una obra salen del importe
 * con IVA cuando ese importe cambia. La cascada escribe el suyo (subtotal 3) en
 * su propia ruta. El formulario de la obra manda siempre el presupuesto: sólo
 * se recalcula si cambió, para no pisar el neto que vino de la cascada.
 */
function prepareNetAmounts(entity: Entity, data: Record<string, unknown>, before: Record<string, unknown> = {}) {
  if (entity === "quotes" && "amountCents" in data && Number(data.amountCents) !== Number(before.amountCents)) {
    const cascade = before.cascade as { ivaPct?: number } | undefined;
    data.netCents = netFromGross(Number(data.amountCents || 0), cascade?.ivaPct);
  }
  if (entity === "works" && "budgetCents" in data && !("budgetNetCents" in data && data.budgetNetCents !== undefined) && Number(data.budgetCents) !== Number(before.budgetCents)) {
    data.budgetNetCents = netFromGross(Number(data.budgetCents || 0));
  }
}

/**
 * Una factura de compra: el tipo tiene que estar habilitado para la empresa
 * que compra y, si viene de una orden de compra, hereda su empresa, su
 * proveedor y su obra (y, por la API, la alícuota y los porcentajes que no
 * traiga). Con el neto cargado, el total sale del neto, el IVA (sólo en la A
 * y sus notas), las percepciones y el impuesto interno.
 */
async function prepareExpense(data: Record<string, unknown>, before: Record<string, unknown> = {}) {
  const merged = { ...before, ...data };
  if (data.purchaseId) {
    const purchase = await Purchase.findById(data.purchaseId).select("company supplierId workId amountCents subtotalCents items vatPct perceptionVatPct perceptionIibbPct perceptionIibbProvPct internalTaxPct").lean<Record<string, unknown> & { company?: string; supplierId?: unknown; workId?: unknown }>();
    if (!purchase) throw new HttpError("La orden de compra elegida no existe");
    // Lo que no vino (una carga por la API): la alícuota y los porcentajes de la OC.
    if (!before._id) {
      const taxes = storedPurchaseTaxes(purchase);
      for (const key of PURCHASE_TAX_PCT_KEYS) if (data[key] === undefined && (key !== "vatPct" || purchase.vatPct !== undefined)) data[key] = taxes[key];
    }
    if (!merged.company && purchase.company) data.company = purchase.company;
    if (!merged.supplierId && purchase.supplierId) data.supplierId = purchase.supplierId;
    // Un GGI o un bien de uso no hereda la obra de la OC.
    if (!merged.workId && purchase.workId && !await worklessAccount(merged.accountId)) data.workId = purchase.workId;
  }
  if ("accountId" in data || "workId" in data) await checkWorkForAccount(merged.accountId, data.workId ?? before.workId);
  await checkPurchaseNote(data, before);
  await checkExpenseReceipts(data, before);
  const company = data.company ?? before.company;
  if (merged.voucherType) {
    if (!company) data.company = "tvp";
    if ("voucherType" in data || "company" in data) await checkVoucherEnabled(companyOf(data.company ?? company).key, "compra", merged.voucherType);
  }
  if (merged.voucherType && "number" in data && String(data.number ?? "") !== String(before.number ?? "")) data.number = purchaseVoucherNumber(data.number);
  const net = Number({ ...before, ...data }.netCents || 0);
  // El formulario manda las percepciones por importe; una carga por la API o de la OC, por porcentaje.
  const byAmount = VOUCHER_TAX_CENTS_KEYS.some(key => key in data);
  if (["netCents", "voucherType", ...PURCHASE_TAX_PCT_KEYS, ...VOUCHER_TAX_CENTS_KEYS].some(key => key in data) && net > 0) {
    // La C y la X no discriminan IVA; la A y sus notas, sí.
    const rates = { ...before, ...data } as Record<string, number | undefined>;
    Object.assign(data, voucherTaxFields(net, rates, Boolean(rates.voucherType) && baseInvoiceType(rates.voucherType) === "factura_a", byAmount ? rates : undefined));
  }
}

/**
 * El número de un comprobante del proveedor: 4 dígitos de punto de venta, guion
 * y 8 de número, 12 en total (Tesorería, 10/11/2026). La letra la da el tipo.
 * Se acepta tipeado con o sin guion, o con la letra adelante.
 */
export function purchaseVoucherNumber(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 12) throw new HttpError(`El número del comprobante lleva 4 números antes del guion y 8 después (12 en total), por ejemplo 0001-00012345. Tiene ${digits.length}.`);
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

/** La OP (no anulada) que paga una factura de compra, si tiene. */
export async function expensePaymentOrder(expenseId: unknown) {
  return Payment.findOne({ status: { $ne: "anulada" }, $or: [{ expenseId }, { "allocations.expenseId": expenseId }] }).select("number").lean<{ number?: string }>();
}

/** Lo que se compara de un campo: la fecha por el día, el id por su texto. */
function comparable(value: unknown) {
  // Un cero, un "no" o un campo vacío que reenvía el formulario es lo mismo que no tenerlo.
  if (value === 0 || value === "0" || value === false || value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) return value.slice(0, 10);
  if (Array.isArray(value) || (value && typeof value === "object" && !("toHexString" in value))) return JSON.stringify(value);
  return String(value ?? "");
}

/** Lo que se puede cambiar de una factura de compra que ya tiene orden de pago. */
const EDITABLE_WITH_PAYMENT = new Set(["description", "attachment", "files"]);

/**
 * Una factura recibida sin orden de pago se corrige entera, incluida la fecha.
 * Con OP queda como se pagó: solo se cambia la descripción y los adjuntos. Para
 * cambiar el resto, primero se anula la OP (reunión con Tesorería, 10/11/2026).
 */
async function checkPaidExpenseChanges(before: Record<string, unknown>, changes: Record<string, unknown>) {
  const changed = Object.keys(changes).filter(key => !EDITABLE_WITH_PAYMENT.has(key) && comparable(changes[key]) !== comparable(before[key]));
  if (!changed.length) return;
  const payment = await expensePaymentOrder(before._id);
  if (payment) throw new HttpError(`La factura ya tiene la orden de pago ${String(payment.number || "")}: solo se cambia la descripción y los adjuntos. Para cambiar el resto, primero anulá la OP.`, 409);
}

/** Una factura recibida con orden de pago no se borra: primero se anula la OP. */
export async function checkExpenseDelete(expenseId: unknown) {
  const payment = await expensePaymentOrder(expenseId);
  if (payment) throw new HttpError(`La factura tiene la orden de pago ${String(payment.number || "")}: para borrarla, primero anulá la OP.`, 409);
}

/**
 * Los remitos que factura una factura de compra son de su OC. Si no se
 * escribió el remito o la conformidad, queda el número de los elegidos. Sin
 * OC no lleva remitos; si cambia la OC, los de la anterior se sueltan.
 */
async function checkExpenseReceipts(data: Record<string, unknown>, before: Record<string, unknown>) {
  const purchaseId = data.purchaseId !== undefined ? data.purchaseId : before.purchaseId;
  if (!("purchaseReceiptIds" in data)) {
    if ("purchaseId" in data && String(data.purchaseId ?? "") !== String(before.purchaseId ?? "") && Array.isArray(before.purchaseReceiptIds) && before.purchaseReceiptIds.length) data.purchaseReceiptIds = [];
    return;
  }
  const ids = [...new Set((Array.isArray(data.purchaseReceiptIds) ? data.purchaseReceiptIds : []).map(String))];
  data.purchaseReceiptIds = ids;
  if (!ids.length) return;
  if (!purchaseId) throw new HttpError("Para elegir remitos, elegí primero la orden de compra");
  const receipts = await PurchaseReceipt.find({ _id: { $in: ids } }).select("number supplierRemito purchaseId").lean<Array<{ _id: unknown; number?: string; supplierRemito?: string; purchaseId?: unknown }>>();
  const foreign = receipts.filter(receipt => String(receipt.purchaseId) !== String(purchaseId));
  if (receipts.length !== ids.length || foreign.length) throw new HttpError(`${foreign.length ? `El remito ${foreign.map(receipt => receipt.supplierRemito || receipt.number).join(", ")} no es` : "Uno de los remitos no es"} de la orden de compra de esta factura`);
  const ref = String(data.receiptRef ?? before.receiptRef ?? "").trim();
  if (!ref) data.receiptRef = receipts.map(receipt => receipt.supplierRemito || receipt.number).join(", ");
}

/**
 * Una nota de débito o de crédito del proveedor puede decir a qué factura
 * corresponde: tiene que ser una factura (no otra nota) del mismo proveedor y
 * de la misma letra. Una que no es nota no lleva factura asociada.
 */
async function checkPurchaseNote(data: Record<string, unknown>, before: Record<string, unknown>) {
  if (!("voucherType" in data || "associatedExpenseId" in data || "supplierId" in data)) return;
  const merged = { ...before, ...data };
  if (!isNote(merged.voucherType)) { if (before.associatedExpenseId || data.associatedExpenseId) data.associatedExpenseId = null; return; }
  if (!merged.associatedExpenseId) return;
  const invoice = await Expense.findById(merged.associatedExpenseId).select("voucherType supplierId number").lean<{ voucherType?: string; supplierId?: unknown; number?: string }>();
  if (!invoice) throw new HttpError("La factura asociada no existe");
  const letter = (type: unknown) => String(type || "").slice(-1);
  if (!invoice.voucherType || isNote(invoice.voucherType) || String(invoice.supplierId || "") !== String(merged.supplierId || "") || letter(invoice.voucherType) !== letter(merged.voucherType)) {
    throw new HttpError(`La ${voucherLabels[String(merged.voucherType)]} va asociada a una factura ${letter(merged.voucherType).toUpperCase()} del mismo proveedor`);
  }
  if (isCreditNote(invoice.voucherType)) throw new HttpError("Una nota no se asocia a una nota de crédito");
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
