import { Invoice, VoucherBook } from "./models";
import { COMPANY_KEYS, type CompanyKey } from "./companies";
import { formatVoucherNumber, isFiscalVoucher, PURCHASE_VOUCHER_TYPES, SALES_VOUCHER_TYPES, voucherLabels, type VoucherType } from "./invoice-labels";
import { HttpError } from "./api";

/*
 * Talonarios de comprobantes por empresa y punto de venta (punto 9 de la
 * especificación). Nada está fijo en el código: qué tipos usa cada empresa y en
 * qué punto de venta se configura en Configuración > Empresas y comprobantes.
 */

export type VoucherBookRow = { _id: string; company: CompanyKey; scope: "venta" | "compra"; voucherType: VoucherType; pointOfSale: string; fiscal: boolean; lastNumber: number; active: boolean; notes?: string };

/** La primera vez: cada empresa vende con A, B y X y compra con A, C y X, en el punto de venta 0001. */
export async function ensureVoucherBooks() {
  if (await VoucherBook.exists({})) return;
  const defaults = COMPANY_KEYS.flatMap(company => [
    ...SALES_VOUCHER_TYPES.map(voucherType => ({ company, scope: "venta", voucherType })),
    ...PURCHASE_VOUCHER_TYPES.map(voucherType => ({ company, scope: "compra", voucherType })),
  ]);
  await VoucherBook.bulkWrite(defaults.map(book => ({
    updateOne: {
      filter: { ...book, pointOfSale: "0001" },
      update: { $setOnInsert: { ...book, pointOfSale: "0001", fiscal: isFiscalVoucher(book.voucherType), lastNumber: 0, active: true } },
      upsert: true,
    },
  })));
}

export async function voucherBooks(filter: Record<string, unknown> = {}) {
  await ensureVoucherBooks();
  const rows = await VoucherBook.find(filter).sort({ company: 1, scope: -1, voucherType: 1, pointOfSale: 1 }).lean<Array<Record<string, unknown>>>();
  return rows.map(row => ({ ...row, _id: String(row._id) }) as unknown as VoucherBookRow);
}

/** El número que sigue al último comprobante fiscal cargado de esa empresa y ese tipo: "0001-00000123" -> "0001-00000124". */
export async function suggestFiscalNumber(company: CompanyKey, voucherType: VoucherType, pointOfSale?: string) {
  const companyFilter = company === "tvp" ? { company: { $in: ["tvp", null] } } : { company };
  // Las facturas viejas no tienen tipo: cuentan como A, que es lo que emitía la empresa.
  const typeFilter = voucherType === "factura_a" ? { voucherType: { $in: ["factura_a", null] } } : { voucherType };
  const last = await Invoice.findOne({ ...companyFilter, ...typeFilter, number: { $not: /^X-/ } }, { number: 1 }).sort({ createdAt: -1 }).lean<{ number?: string }>();
  const match = String(last?.number || "").match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return pointOfSale ? formatVoucherNumber(pointOfSale, 1) : "";
  const [, prefix, digits, suffix] = match;
  return `${prefix}${String(Number(digits) + 1).padStart(digits.length, "0")}${suffix}`;
}

/** El próximo número de la X sin gastarlo (para mostrarlo en el formulario). */
export async function peekInternalNumber(company: CompanyKey, pointOfSale = "0001") {
  await ensureVoucherBooks();
  const book = await VoucherBook.findOne({ company, scope: "venta", voucherType: "factura_x", pointOfSale }).lean<{ lastNumber?: number }>();
  return `X-${formatVoucherNumber(pointOfSale, Number(book?.lastNumber || 0) + 1)}`;
}

/**
 * Toma el número que sigue en el talonario interno (X) de la empresa. Es
 * atómico: dos facturas X al mismo tiempo no pueden salir con el mismo número.
 */
export async function takeInternalNumber(company: CompanyKey, pointOfSale = "0001") {
  await ensureVoucherBooks();
  const book = await VoucherBook.findOneAndUpdate(
    { company, scope: "venta", voucherType: "factura_x", pointOfSale, active: true },
    { $inc: { lastNumber: 1 } },
    { returnDocument: "after" },
  ).lean<{ lastNumber: number }>();
  if (!book) throw new HttpError(`La empresa no tiene un talonario X activo en el punto de venta ${pointOfSale}. Se habilita en Configuración > Empresas y comprobantes.`);
  return `X-${formatVoucherNumber(pointOfSale, book.lastNumber)}`;
}

/** Que el tipo elegido esté habilitado para esa empresa. Las facturas viejas, sin tipo, pasan. */
export async function checkVoucherEnabled(company: CompanyKey, scope: "venta" | "compra", voucherType: unknown) {
  if (!voucherType) return;
  await ensureVoucherBooks();
  const enabled = await VoucherBook.exists({ company, scope, voucherType, active: true });
  if (!enabled) throw new HttpError(`La empresa no tiene habilitada la ${voucherLabels[String(voucherType)] || String(voucherType)} para ${scope === "venta" ? "vender" : "comprar"}. Se habilita en Configuración > Empresas y comprobantes.`);
}
