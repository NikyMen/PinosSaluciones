import { Types } from "mongoose";
import { z } from "zod";
import { Client, Counter, CounterSale } from "./models";
import { HttpError } from "./api";
import { audit } from "./audit";
import { schemas } from "./schemas";
import { arcaCredentials, checkReceiver } from "./arca";
import { COMPANIES, COMPANY_KEYS, type CompanyKey } from "./companies";
import { vatConditionFor, type ArcaVoucherType } from "./fiscal";
import { accountByName } from "./account-service";
import { DEFAULT_ACCOUNTS } from "./account-catalog";
import { resolveCashAccount } from "./cash-accounts";
import { accountTypesFor, cashMethodLabels } from "./cash-methods";
import { checkVoucherEnabled } from "./voucher-books";
import { cancelSalesRemito, createSalesRemito } from "./sales-remitos";
import { createInvoice } from "./invoice-create";
import { receiptSchema, saveReceipt } from "./receipt-service";
import { invoiceLabel } from "./invoice-labels";
import { money, todayIso } from "./format";
import { counterTotals } from "./counter-totals";
import { canWrite, type PermissionSubject } from "./permissions";
import type { Session } from "./auth";

/*
 * El Mostrador: la venta al público en el Salón de Ventas, en un solo paso.
 * Se escanean o se buscan los productos y, al cobrar, el sistema hace lo mismo
 * que antes se hacía en tres pantallas:
 *
 * 1. el remito de venta al cliente, que baja el stock del Salón
 *    (src/lib/sales-remitos.ts);
 * 2. la factura de ese remito: B o A emitida en ARCA con CAE, o la X interna
 *    (src/lib/invoice-create.ts);
 * 3. el recibo con los medios de cobro, a la cuenta "CI - VENTA DE MATERIALES"
 *    (src/lib/receipt-service.ts).
 *
 * Sin cliente elegido, se vende al cliente genérico "Consumidor Final"; el
 * nombre y el DNI que dé el comprador van en la factura y a ARCA. Antes de mover
 * el stock se revisa todo lo que puede fallar (talonario, ARCA, cajas, que el
 * cobro dé el total). Si la factura no sale, el remito se anula y el material
 * vuelve al Salón. Si la factura salió y el recibo no, la venta queda "sin
 * cobro" y se cobra desde Cobranzas.
 */

/** Vender en el mostrador mueve stock, factura y cobra: hacen falta los tres permisos. */
export function canSellAtCounter(session: PermissionSubject) {
  return canWrite(session, "stock") && canWrite(session, "invoices") && canWrite(session, "collections");
}

export const CONSUMER_CLIENT_NAME = "Consumidor Final";
export const COUNTER_VOUCHERS = ["factura_b", "factura_a", "factura_x"] as const;
export type CounterVoucher = (typeof COUNTER_VOUCHERS)[number];

const id = z.string().regex(/^[a-f\d]{24}$/i, "ID inválido");
const paymentLine = receiptSchema.shape.lines.unwrap().element;

export const counterSaleSchema = z.object({
  company: z.enum(COMPANY_KEYS).default("tvp"),
  voucherType: z.enum(COUNTER_VOUCHERS, { error: "Elegí el comprobante" }),
  clientId: id.or(z.literal("")).optional().transform(value => value || undefined),
  buyerName: z.string().trim().max(120).optional().default(""),
  buyerDocument: z.string().trim().max(20).optional().default("").transform(value => value.replace(/\D/g, ""))
    .refine(value => !value || [7, 8, 11].includes(value.length), "El DNI tiene 7 u 8 números y el CUIT, 11"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(500).optional().default(""),
  lines: z.array(z.object({
    itemId: id,
    quantity: z.coerce.number().positive("Cada cantidad tiene que ser mayor a cero"),
    unitPriceCents: z.coerce.number().int().min(0),
    discountCents: z.coerce.number().int().min(0).default(0),
  })).min(1, "Agregá al menos un producto").max(100),
  payments: z.array(paymentLine).min(1, "Elegí con qué paga").max(10),
});
export type CounterSaleInput = z.infer<typeof counterSaleSchema>;

/**
 * El cliente genérico de las ventas sin identificar: el "Consumidor Final" sin
 * CUIT que ya esté cargado (aunque no tenga la condición de IVA: sin ella, la B
 * va igual a consumidor final) o uno nuevo, la primera vez que se lo necesita.
 */
export async function consumerClient() {
  const existing = await Client.findOne({
    name: { $regex: `^\\s*${CONSUMER_CLIENT_NAME}\\s*$`, $options: "i" },
    vatCondition: { $in: [null, "consumidor_final"] },
    $or: [{ cuit: { $exists: false } }, { cuit: "" }, { cuit: null }],
  })
    .sort({ createdAt: 1 }).lean<{ _id: Types.ObjectId; name: string; cuit?: string; vatCondition?: string }>();
  if (existing) return existing;
  const created = await Client.create({ name: CONSUMER_CLIENT_NAME, vatCondition: "consumidor_final", notes: "Cliente de las ventas por Mostrador sin identificar. No borrar." });
  return created.toObject() as { _id: Types.ObjectId; name: string; cuit?: string; vatCondition?: string };
}

async function nextCounterSaleNumber() {
  const counter = await Counter.findByIdAndUpdate("counter_sales", { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return `VM-${counter.seq}`;
}

const message = (error: unknown) => error instanceof Error ? error.message : "error desconocido";

export async function registerCounterSale(input: CounterSaleInput, session: Session, ip?: string) {
  const company = input.company as CompanyKey;
  const fiscal = input.voucherType !== "factura_x";
  const date = input.date || todayIso();

  // El cliente: el elegido o el Consumidor Final genérico, con lo que dio el comprador.
  const chosen = input.clientId ? await Client.findById(input.clientId).select("name cuit vatCondition").lean<{ _id: Types.ObjectId; name: string; cuit?: string; vatCondition?: string }>() : null;
  if (input.clientId && !chosen) throw new HttpError("El cliente elegido no existe");
  const client = chosen || await consumerClient();
  const anonymous = !chosen;
  const buyerName = anonymous ? input.buyerName : "";
  const buyerDocument = anonymous ? input.buyerDocument : "";

  // Lo que se cobra, antes de tocar nada.
  for (const line of input.lines) if (line.discountCents > Math.round(line.quantity * line.unitPriceCents)) throw new HttpError("Un descuento pasa el importe de su renglón");
  const totals = counterTotals(input.voucherType, input.lines);
  if (totals.netCents <= 0) throw new HttpError("La venta no tiene importe: revisá los precios");
  const paid = input.payments.reduce((total, line) => total + line.amountCents, 0);
  if (paid !== totals.amountCents) throw new HttpError(`Lo cobrado (${money(paid)}) tiene que dar el total de la venta (${money(totals.amountCents)})`);

  // El comprobante: habilitado en la empresa y, si es fiscal, con ARCA conectada y el comprador que corresponde.
  await checkVoucherEnabled(company, "venta", input.voucherType);
  if (fiscal) {
    if (!arcaCredentials(company)) throw new HttpError(`${COMPANIES[company].short} no está conectada con ARCA: vendé con Factura X o pedí que se cargue su certificado`);
    checkReceiver({ voucherType: input.voucherType as ArcaVoucherType, vatCondition: vatConditionFor(input.voucherType, client.vatCondition), clientCuit: String(client.cuit || ""), buyerDocument, amountCents: totals.amountCents });
  }
  // La cuenta del plan del cobro y las cajas de cada medio.
  const ledger = await accountByName(DEFAULT_ACCOUNTS.materialSale);
  if (!ledger) throw new HttpError(`Falta la cuenta "${DEFAULT_ACCOUNTS.materialSale}" en el plan de cuentas`);
  for (const line of input.payments) {
    const label = cashMethodLabels[line.method].toLowerCase();
    if (!line.cashAccountId) throw new HttpError(`Elegí la caja o cuenta donde entra la ${label}`);
    const account = await resolveCashAccount(line.cashAccountId, { company });
    const types = accountTypesFor(line.method, "cobro");
    if (account && types && !types.includes(account.type as never)) throw new HttpError(`${account.name} no sirve para cobrar con ${label}`);
  }

  const number = await nextCounterSaleNumber();
  const note = [`Mostrador ${number}`, buyerName && `Compró ${buyerName}`, input.note].filter(Boolean).join(" · ");

  // 1. El remito baja el stock del Salón. Si algo no alcanza, no sale nada.
  const { remito, changed } = await createSalesRemito({ company, clientId: String(client._id), quoteId: undefined, date: new Date(`${date}T00:00:00.000Z`), note, lines: input.lines }, session);
  await audit(session, "create", "sales_remitos", remito._id, null, remito, ip);
  for (const entry of changed) await audit(session, "stock_venta", "stock", entry.item._id, entry.before, entry.after, ip);

  // 2. La factura del remito. Si no sale, el remito se anula y el material vuelve al Salón.
  const data = schemas.invoices.parse({
    company, voucherType: input.voucherType, withRemito: true, remitoIds: [String(remito._id)], clientId: String(client._id),
    issueDate: date, netCents: totals.netCents, vatPct: totals.vatPct, description: `Venta por mostrador ${number}`,
    buyerName: buyerName || undefined, buyerDocument: buyerDocument || undefined, arcaEmit: fiscal,
  }) as Record<string, unknown>;
  data.origin = "mostrador";
  let invoice;
  try {
    invoice = (await createInvoice(data, session, ip)).toObject() as Record<string, unknown> & { _id: Types.ObjectId };
  } catch (error) {
    // Con CAE la factura existe en ARCA aunque no se haya guardado: el remito queda como está.
    if (!data.cae) await cancelSalesRemito(String(remito._id), `No se pudo facturar la venta ${number}: ${message(error)}`, session)
      .catch(problem => console.error("No se pudo anular el remito de una venta por mostrador sin factura", { number, remito: remito.number, problem }));
    throw error;
  }

  // 3. El recibo, con los medios de cobro. Si falla, la venta queda facturada y "sin cobro".
  let receipt: Record<string, unknown> | null = null;
  let warning = "";
  try {
    receipt = await saveReceipt({
      clientId: String(client._id), date: new Date(`${date}T00:00:00.000Z`), company, accountId: String(ledger._id),
      lines: input.payments, allocations: [{ invoiceId: String(invoice._id), amountCents: Number(invoice.amountCents || 0) }],
      notes: `Venta por mostrador ${number}${buyerName ? ` · ${buyerName}` : ""}`,
    }, session) as Record<string, unknown>;
    await audit(session, "create", "collections", receipt._id, null, receipt, ip);
  } catch (error) {
    warning = `La venta quedó facturada, pero no se pudo registrar el cobro (${message(error)}). Cargalo en Ventas › Cobranzas y recibos.`;
  }

  const sale = await CounterSale.create({
    number, date: new Date(`${date}T00:00:00.000Z`), company, voucherType: input.voucherType,
    clientId: client._id, clientName: client.name, buyerName: buyerName || undefined, buyerDocument: buyerDocument || undefined,
    remitoId: remito._id, remitoNumber: remito.number, invoiceId: invoice._id, invoiceLabel: invoiceLabel(invoice),
    collectionId: receipt?._id, receiptNumber: receipt?.number,
    lines: (remito.lines as Array<Record<string, unknown>>).map(line => {
      const item = changed.find(entry => String(entry.item._id) === String(line.stockItemId))?.item as { sku?: string; barcode?: string } | undefined;
      return { stockItemId: line.stockItemId, name: line.name, sku: item?.sku, barcode: item?.barcode, unit: line.unit, quantity: line.quantity, unitPriceCents: line.unitPriceCents, discountCents: line.discountCents, totalCents: line.totalCents };
    }),
    netCents: Number(invoice.netCents || 0), vatPct: Number(invoice.vatPct || 0), vatCents: Number(invoice.vatCents || 0), amountCents: Number(invoice.amountCents || 0),
    payments: receipt ? (receipt.lines as Array<Record<string, unknown>>).map(line => ({ method: line.method, account: line.account, amountCents: line.amountCents })) : [],
    status: receipt ? "cobrada" : "sin_cobro", warning: warning || undefined, note: input.note || undefined,
    userId: session.userId, userName: session.name,
  });
  await audit(session, "create", "counter_sales", sale._id, null, sale.toObject(), ip);
  return { sale: sale.toObject() as Record<string, unknown>, invoice, warning };
}

/** Las ventas de un día (dd = aaaa-mm-dd) con el cierre: total por medio de cobro y por comprobante. */
export async function counterDay(day: string) {
  const from = new Date(`${day}T00:00:00.000Z`);
  const to = new Date(from.getTime() + 86_400_000);
  const items = await CounterSale.find({ date: { $gte: from, $lt: to } }).sort({ createdAt: -1 }).lean<Array<Record<string, unknown>>>();
  const byMethod = new Map<string, number>();
  const byVoucher = new Map<string, number>();
  let totalCents = 0;
  let pendingCents = 0;
  for (const sale of items) {
    totalCents += Number(sale.amountCents || 0);
    if (sale.status === "sin_cobro") pendingCents += Number(sale.amountCents || 0);
    byVoucher.set(String(sale.voucherType), (byVoucher.get(String(sale.voucherType)) || 0) + Number(sale.amountCents || 0));
    for (const payment of (sale.payments || []) as Array<{ method: string; amountCents: number }>) byMethod.set(payment.method, (byMethod.get(payment.method) || 0) + Number(payment.amountCents || 0));
  }
  return {
    day, items,
    summary: {
      count: items.length, totalCents, pendingCents,
      byMethod: [...byMethod].map(([method, amountCents]) => ({ method, label: cashMethodLabels[method] || method, amountCents })),
      byVoucher: [...byVoucher].map(([voucherType, amountCents]) => ({ voucherType, amountCents })),
    },
  };
}
