import type { Types } from "mongoose";
import { Account, CashMovement, Client, Collection, Expense, Invoice, Payment, Supplier } from "./models";
import { ensureAccountCatalog } from "./account-service";
import { accountDirection, type AccountCode } from "./account-catalog";
import { invoiceLabel, isFiscalVoucher, voucherLabels, VOID_INVOICE_STATUSES } from "./invoice-labels";
import { collectionAllocations, effectivePayments } from "./balances";
import { companyOf, type CompanyKey } from "./companies";
import { excludedFromTotals } from "./trash";

/*
 * Contabilidad: lo que se mira, no se carga.
 *
 * - Libro IVA: solo los comprobantes fiscales (A, B, C). La X queda afuera
 *   siempre: no pasa por ARCA.
 * - Movimientos por cuenta: cada peso que entró o salió (caja y bancos,
 *   recibos y pagos) agrupado por código y cuenta del plan.
 */

type Lean = Record<string, unknown> & { _id: Types.ObjectId };
export type Period = { from: Date; to: Date; company?: CompanyKey | "" };

export type IvaRow = { _id: string; date: string; voucher: string; number: string; party: string; cuit: string; company: CompanyKey; netCents: number; vatCents: number; totalCents: number };
export type IvaBook = { sales: IvaRow[]; purchases: IvaRow[]; totals: { sales: Totals; purchases: Totals }; excludedX: { sales: number; purchases: number } };
type Totals = { netCents: number; vatCents: number; totalCents: number };

const iso = (value: unknown) => value ? new Date(value as Date).toISOString() : "";
const sum = (rows: IvaRow[]): Totals => rows.reduce((total, row) => ({ netCents: total.netCents + row.netCents, vatCents: total.vatCents + row.vatCents, totalCents: total.totalCents + row.totalCents }), { netCents: 0, vatCents: 0, totalCents: 0 });

function companyFilter(company?: string) {
  if (!company) return {};
  return company === "tvp" ? { company: { $in: ["tvp", null] } } : { company };
}

/** Neto e IVA de un comprobante: si se cargó solo el total, el total es neto (no se inventa IVA). */
function split(record: Record<string, unknown>) {
  const total = Number(record.amountCents || 0);
  const net = Number(record.netCents || 0);
  const vat = Number(record.vatCents || 0);
  return net > 0 ? { netCents: net, vatCents: vat, totalCents: total || net + vat } : { netCents: total, vatCents: 0, totalCents: total };
}

export async function ivaBook({ from, to, company }: Period): Promise<IvaBook> {
  const excluded = await excludedFromTotals();
  const [invoices, expenses] = await Promise.all([
    Invoice.find({ _id: { $nin: excluded.invoices }, ...companyFilter(company), status: { $nin: VOID_INVOICE_STATUSES }, issueDate: { $gte: from, $lte: to } }).sort({ issueDate: 1, number: 1 }).lean<Lean[]>(),
    // Una factura de compra es un gasto con tipo de comprobante; los costos internos no van al libro.
    Expense.find({ _id: { $nin: excluded.expenses }, ...companyFilter(company), voucherType: { $exists: true, $ne: null }, status: { $ne: "anulado" }, issueDate: { $gte: from, $lte: to } }).sort({ issueDate: 1 }).lean<Lean[]>(),
  ]);
  const [clients, suppliers] = await Promise.all([
    Client.find({ _id: { $in: invoices.map(invoice => invoice.clientId) } }).select("name cuit").lean<Lean[]>(),
    Supplier.find({ _id: { $in: expenses.map(expense => expense.supplierId).filter(Boolean) } }).select("name cuit").lean<Lean[]>(),
  ]);
  const clientById = new Map(clients.map(client => [String(client._id), client]));
  const supplierById = new Map(suppliers.map(supplier => [String(supplier._id), supplier]));

  const fiscalInvoices = invoices.filter(invoice => isFiscalVoucher(invoice.voucherType));
  const fiscalExpenses = expenses.filter(expense => isFiscalVoucher(expense.voucherType));
  const sales = fiscalInvoices.map(invoice => {
    const client = clientById.get(String(invoice.clientId));
    return { _id: String(invoice._id), date: iso(invoice.issueDate), voucher: voucherLabels[String(invoice.voucherType || "factura_a")] || "Factura", number: invoiceLabel({ number: invoice.number }), party: String(client?.name || "—"), cuit: String(client?.cuit || ""), company: companyOf(invoice.company).key, ...split(invoice) };
  });
  const purchases = fiscalExpenses.map(expense => {
    const supplier = supplierById.get(String(expense.supplierId));
    return { _id: String(expense._id), date: iso(expense.issueDate), voucher: voucherLabels[String(expense.voucherType)] || "Factura", number: String(expense.number || "—"), party: String(supplier?.name || "—"), cuit: String(supplier?.cuit || ""), company: companyOf(expense.company).key, ...split(expense) };
  });
  return {
    sales, purchases, totals: { sales: sum(sales), purchases: sum(purchases) },
    excludedX: { sales: invoices.length - fiscalInvoices.length, purchases: expenses.length - fiscalExpenses.length },
  };
}

export type LedgerMovement = { _id: string; source: "caja" | "recibo" | "pago"; date: string; description: string; cashAccount: string; direction: "ingreso" | "egreso"; amountCents: number; company: CompanyKey | ""; transferId?: string; href: string };
export type LedgerLine = { accountId: string; code: AccountCode; name: string; direction: "ingreso" | "egreso"; inCents: number; outCents: number; count: number };
export type LedgerSummary = { lines: LedgerLine[]; byCode: Array<{ code: AccountCode; inCents: number; outCents: number }>; unassigned: { count: number; inCents: number; outCents: number }; totals: { inCents: number; outCents: number } };

/** Todos los movimientos de plata del período, cada uno con su cuenta del plan (o sin cuenta, si es de antes). */
export async function ledgerMovements({ from, to, company }: Period, accountId?: string): Promise<Array<LedgerMovement & { accountId: string }>> {
  const byAccount = accountId ? { accountId } : {};
  const [cash, collections, payments] = await Promise.all([
    CashMovement.find({ ...byAccount, ...companyFilter(company), date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean<Lean[]>(),
    Collection.find({ ...byAccount, date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean<Lean[]>(),
    Payment.find({ ...byAccount, ...effectivePayments, ...companyFilter(company), date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean<Lean[]>(),
  ]);
  // Un recibo es de la empresa de las facturas que cobra.
  const invoiceIds = collections.flatMap(collection => collectionAllocations(collection).map(allocation => allocation.invoiceId));
  const [invoices, clients, suppliers] = await Promise.all([
    Invoice.find({ _id: { $in: invoiceIds } }).select("company").lean<Lean[]>(),
    Client.find({ _id: { $in: collections.map(collection => collection.clientId) } }).select("name").lean<Lean[]>(),
    Supplier.find({ _id: { $in: payments.map(payment => payment.supplierId).filter(Boolean) } }).select("name").lean<Lean[]>(),
  ]);
  const invoiceCompany = new Map(invoices.map(invoice => [String(invoice._id), companyOf(invoice.company).key]));
  const clientName = new Map(clients.map(client => [String(client._id), String(client.name || "")]));
  const supplierName = new Map(suppliers.map(supplier => [String(supplier._id), String(supplier.name || "")]));

  const rows: Array<LedgerMovement & { accountId: string }> = [
    ...cash.map(movement => ({
      _id: String(movement._id), source: "caja" as const, date: iso(movement.date), description: String(movement.description || ""), cashAccount: String(movement.account || ""),
      direction: movement.direction === "ingreso" ? "ingreso" as const : "egreso" as const, amountCents: Number(movement.amountCents || 0),
      company: movement.company ? companyOf(movement.company).key : "" as const, transferId: movement.transferId ? String(movement.transferId) : undefined,
      accountId: String(movement.accountId || ""), href: "/app/cash",
    })),
    ...collections.map(collection => {
      const first = collectionAllocations(collection)[0];
      const receiptCompany = first ? invoiceCompany.get(String(first.invoiceId)) || "" : "";
      return {
        _id: String(collection._id), source: "recibo" as const, date: iso(collection.date), description: `Recibo ${String(collection.number || "")} · ${clientName.get(String(collection.clientId)) || "Cliente"}`,
        cashAccount: String(collection.account || ""), direction: "ingreso" as const, amountCents: Number(collection.amountCents || 0),
        company: receiptCompany as CompanyKey | "", accountId: String(collection.accountId || ""), href: "/app/collections",
      };
    }).filter(row => !company || row.company === company),
    ...payments.map(payment => ({
      _id: String(payment._id), source: "pago" as const, date: iso(payment.date), description: `${payment.number ? `Pago ${String(payment.number)}` : "Pago"} · ${supplierName.get(String(payment.supplierId)) || "Proveedor"}`,
      cashAccount: String(payment.account || ""), direction: "egreso" as const, amountCents: Number(payment.amountCents || 0) - Number(payment.retentionsCents || 0),
      company: companyOf(payment.company).key, accountId: String(payment.accountId || ""), href: "/app/payments",
    })),
  ];
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** Lo que entró y salió por cada cuenta del plan, y por código (CI, GGD, GGI…). Lo de antes sin cuenta va aparte. */
export async function ledgerSummary(period: Period): Promise<LedgerSummary> {
  await ensureAccountCatalog();
  const [movements, accounts] = await Promise.all([ledgerMovements(period), Account.find({}).lean<Lean[]>()]);
  const accountById = new Map(accounts.map(account => [String(account._id), account]));
  const lines = new Map<string, LedgerLine>();
  const unassigned = { count: 0, inCents: 0, outCents: 0 };
  for (const movement of movements) {
    const account = accountById.get(movement.accountId);
    if (!account) {
      unassigned.count++;
      if (movement.direction === "ingreso") unassigned.inCents += movement.amountCents; else unassigned.outCents += movement.amountCents;
      continue;
    }
    const code = account.code as AccountCode;
    const line = lines.get(movement.accountId) || { accountId: movement.accountId, code, name: String(account.name), direction: accountDirection(code), inCents: 0, outCents: 0, count: 0 };
    if (movement.direction === "ingreso") line.inCents += movement.amountCents; else line.outCents += movement.amountCents;
    line.count++;
    lines.set(movement.accountId, line);
  }
  const sorted = [...lines.values()].sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name, "es"));
  const codes = new Map<AccountCode, { code: AccountCode; inCents: number; outCents: number }>();
  for (const line of sorted) {
    const entry = codes.get(line.code) || { code: line.code, inCents: 0, outCents: 0 };
    entry.inCents += line.inCents; entry.outCents += line.outCents;
    codes.set(line.code, entry);
  }
  const totals = sorted.reduce((total, line) => ({ inCents: total.inCents + line.inCents, outCents: total.outCents + line.outCents }), { inCents: unassigned.inCents, outCents: unassigned.outCents });
  return { lines: sorted, byCode: [...codes.values()], unassigned, totals };
}
