import type { jsPDF } from "jspdf";
import { date } from "./format";
import { invoiceLabel } from "./invoice-labels";
import { plain, readPdfLogo } from "./pdf-brand";
import { companyOf, type CompanyKey } from "./companies";
import { ARCA_VOUCHER_CODE, arcaQrUrl, VAT_CONDITIONS, vatConditionFor, type ArcaVoucherType } from "./fiscal";

/**
 * La factura (o nota de débito o de crédito) A o B emitida en ARCA, en PDF: el formato del comprobante
 * electrónico (letra y código arriba al medio, emisor, receptor, detalle,
 * totales) con el CAE, su vencimiento y el QR de ARCA. La B muestra el IVA
 * contenido (Régimen de Transparencia Fiscal al Consumidor, Ley 27.743).
 */

export type FiscalInvoicePdfData = {
  company: CompanyKey; voucherType: ArcaVoucherType; number: string;
  /** En una nota: la factura a la que corresponde ("Factura A 0003-00000012 del 06/10/2026"). */
  associated?: string;
  issueDate: string; dueDate?: string; description: string;
  netCents: number; vatPct: number; vatCents: number; amountCents: number;
  cae: string; caeDueDate: string; environment?: string;
  /** Con remitos es venta de productos; si no, servicios (lleva el período facturado). */
  products: boolean;
  client: { name: string; cuit: string; address?: string; vatCondition?: string };
};

const pesos = (cents: number) => plain((cents / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function fiscalInvoicePdfData(invoice: Record<string, unknown>, client?: Record<string, unknown> | null, associated?: Record<string, unknown> | null): FiscalInvoicePdfData {
  return {
    company: companyOf(invoice.company).key, voucherType: String(invoice.voucherType) in ARCA_VOUCHER_CODE ? invoice.voucherType as ArcaVoucherType : "factura_a",
    associated: associated ? `${invoiceLabel(associated)} del ${date(String(associated.issueDate || ""))}` : undefined,
    number: String(invoice.number || ""), issueDate: String(invoice.issueDate || ""), dueDate: invoice.dueDate ? String(invoice.dueDate) : undefined,
    description: String(invoice.description || "Servicios"),
    netCents: Number(invoice.netCents || 0), vatPct: Number(invoice.vatPct ?? 21), vatCents: Number(invoice.vatCents || 0), amountCents: Number(invoice.amountCents || 0),
    cae: String(invoice.cae || ""), caeDueDate: String(invoice.caeDueDate || ""), environment: String(invoice.arcaEnvironment || ""),
    products: Array.isArray(invoice.remitoIds) && invoice.remitoIds.length > 0,
    client: { name: String(client?.name || "Cliente"), cuit: String(client?.cuit || ""), address: String(client?.address || ""), vatCondition: client?.vatCondition ? String(client.vatCondition) : undefined },
  };
}

/** Escribe la factura. Devuelve el nombre con el que conviene guardarla. */
export function buildFiscalInvoicePdf(doc: jsPDF, data: FiscalInvoicePdfData, meta: { logo?: string; qr: string }) {
  const company = companyOf(data.company);
  const isA = !data.voucherType.endsWith("_b");
  const title = data.voucherType.startsWith("nota_credito") ? "NOTA DE CRÉDITO" : data.voucherType.startsWith("nota_debito") ? "NOTA DE DÉBITO" : "FACTURA";
  const [pointOfSale, sequence] = data.number.split("-");
  const M = 10, W = 190;
  const kv = (label: string, value: string, x: number, y: number) => {
    doc.setFont("helvetica", "bold"); doc.text(label, x, y);
    const width = doc.getTextWidth(label);
    doc.setFont("helvetica", "normal"); doc.text(plain(value), x + width + 1.5, y);
  };
  doc.setLineWidth(0.3);
  doc.setTextColor(0, 0, 0);

  doc.rect(M, 8, W, 8); doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("ORIGINAL", 105, 13.6, { align: "center" });

  // Cabecera: emisor, letra, comprobante.
  doc.rect(M, 16, W, 48); doc.line(105, 34, 105, 64);
  doc.setFillColor(255, 255, 255); doc.rect(96, 16, 18, 18, "FD");
  doc.setFontSize(26); doc.text(isA ? "A" : "B", 105, 27.5, { align: "center" });
  doc.setFontSize(7); doc.text(`COD. ${String(ARCA_VOUCHER_CODE[data.voucherType]).padStart(2, "0")}`, 105, 32, { align: "center" });
  if (meta.logo) { try { doc.addImage(meta.logo, "JPEG", M + 3, 18, 22, 22); } catch { /* sin logo sale igual */ } }
  doc.setFontSize(12); doc.text(company.legalName.toUpperCase(), M + 28, 25, { maxWidth: 55 });
  doc.setFontSize(8.5);
  kv("Razón Social:", company.legalName.toUpperCase(), M + 3, 46);
  kv("Domicilio Comercial:", company.address, M + 3, 52);
  kv("Condición frente al IVA:", company.vat || "IVA Responsable Inscripto", M + 3, 58);

  doc.setFont("helvetica", "bold"); doc.setFontSize(title === "FACTURA" ? 18 : 15); doc.text(title, 118, 26);
  doc.setFontSize(9);
  kv("Punto de Venta:", `${pointOfSale}     Comp. Nro: ${sequence}`, 110, 40);
  kv("Fecha de Emisión:", date(data.issueDate), 110, 45.2);
  kv("CUIT:", company.cuit.replace(/\D/g, ""), 110, 50.4);
  kv("Ingresos Brutos:", company.iibb || "-", 110, 55.6);
  kv("Fecha de Inicio de Actividades:", company.since || "-", 110, 60.8);

  // Período facturado (servicios).
  doc.rect(M, 66, W, 8); doc.setFontSize(8.5);
  const issue = new Date(data.issueDate);
  if (!data.products) {
    const from = new Date(Date.UTC(issue.getUTCFullYear(), issue.getUTCMonth(), 1));
    const to = new Date(Date.UTC(issue.getUTCFullYear(), issue.getUTCMonth() + 1, 0));
    kv("Período Facturado Desde:", date(from), M + 3, 71.2);
    kv("Hasta:", date(to), 82, 71.2);
  }
  kv("Fecha de Vto. para el pago:", date(data.dueDate && new Date(data.dueDate) > issue ? data.dueDate : data.issueDate), 128, 71.2);

  // Receptor.
  doc.rect(M, 76, W, 20);
  kv("CUIT:", data.client.cuit.replace(/\D/g, ""), M + 3, 82);
  kv("Apellido y Nombre / Razón Social:", data.client.name.toUpperCase().slice(0, 48), 62, 82);
  kv("Condición frente al IVA:", VAT_CONDITIONS[vatConditionFor(data.voucherType, data.client.vatCondition)].label, M + 3, 88);
  kv("Domicilio:", (data.client.address || "-").slice(0, 50), 100, 88);
  kv("Condición de venta:", "Cuenta Corriente", M + 3, 94);
  if (data.associated) kv("Comprobante asociado:", data.associated, 100, 94);

  // Detalle: un renglón con la descripción. La A discrimina el IVA; la B lo lleva incluido.
  const columns: Array<[string, number, number]> = isA
    ? [["Código", M, 14], ["Producto / Servicio", M + 14, 70], ["Cantidad", M + 84, 16], ["U. Medida", M + 100, 16], ["Precio Unit.", M + 116, 24], ["Subtotal", M + 140, 26], ["Alícuota IVA", M + 166, 24]]
    : [["Código", M, 14], ["Producto / Servicio", M + 14, 96], ["Cantidad", M + 110, 16], ["U. Medida", M + 126, 16], ["Precio Unit.", M + 142, 24], ["Subtotal", M + 166, 24]];
  doc.setFillColor(204, 204, 204); doc.rect(M, 99, W, 7, "FD"); doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
  columns.forEach(([title, x, width]) => doc.text(title, x + width / 2, 103.6, { align: "center" }));
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  const price = isA ? data.netCents : data.amountCents;
  const lines = doc.splitTextToSize(plain(data.description), isA ? 68 : 94).slice(0, 14);
  doc.text("001", M + 7, 112, { align: "center" });
  doc.text(lines, M + 15, 112);
  if (isA) {
    doc.text("1,00", M + 98, 112, { align: "right" }); doc.text("unidades", M + 108, 112, { align: "center" });
    doc.text(pesos(price), M + 138, 112, { align: "right" }); doc.text(pesos(price), M + 164, 112, { align: "right" });
    doc.text(`${String(data.vatPct).replace(".", ",")}%`, M + 178, 112, { align: "center" });
  } else {
    doc.text("1,00", M + 124, 112, { align: "right" }); doc.text("unidades", M + 134, 112, { align: "center" });
    doc.text(pesos(price), M + 164, 112, { align: "right" }); doc.text(pesos(price), M + 188, 112, { align: "right" });
  }

  // Totales.
  doc.rect(M, 200, W, 52); doc.setFontSize(8.5); doc.setFont("helvetica", "bold");
  const totals: Array<[string, number]> = isA
    ? [["Importe Neto Gravado: $", data.netCents], ...[27, 21, 10.5, 5, 2.5, 0].map(rate => [`IVA ${String(rate).replace(".", ",")}%: $`, rate === data.vatPct ? data.vatCents : 0] as [string, number]), ["Importe Otros Tributos: $", 0]]
    : [["Subtotal: $", data.amountCents], ["Importe Otros Tributos: $", 0]];
  totals.forEach(([label, value], index) => { doc.text(label, 165, 206 + index * 5, { align: "right" }); doc.text(pesos(value), 196, 206 + index * 5, { align: "right" }); });
  if (!isA) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    doc.text("Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)", M + 3, 238);
    doc.setFont("helvetica", "bold"); doc.text(`IVA Contenido: $ ${pesos(data.vatCents)}`, M + 3, 243);
  }
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
  doc.text("Importe Total: $", 165, 248.5, { align: "right" }); doc.text(pesos(data.amountCents), 196, 248.5, { align: "right" });

  // Pie: QR, CAE y su vencimiento.
  try { doc.addImage(meta.qr, "PNG", M, 255, 30, 30); } catch { /* sin QR sale igual */ }
  doc.setFontSize(11); doc.text("ARCA", M + 34, 264);
  doc.setFontSize(8); doc.text("Comprobante Autorizado", M + 34, 270);
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.5);
  doc.text("Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación", M + 34, 274);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold"); doc.text("CAE N°:", 165, 264, { align: "right" }); doc.setFont("helvetica", "normal"); doc.text(data.cae, 167, 264);
  doc.setFont("helvetica", "bold"); doc.text("Fecha de Vto. de CAE:", 165, 270, { align: "right" }); doc.setFont("helvetica", "normal"); doc.text(date(data.caeDueDate), 167, 270);
  doc.setFontSize(7.5); doc.text("Pág. 1/1", 105, 290, { align: "center" });

  // Una factura del ambiente de prueba de ARCA no vale: que se note.
  if (data.environment === "homologacion") {
    doc.saveGraphicsState(); doc.setGState(new (doc as unknown as { GState: new (options: { opacity: number }) => unknown }).GState({ opacity: 0.16 }) as never);
    doc.setTextColor(224, 0, 16); doc.setFont("helvetica", "bold"); doc.setFontSize(30);
    doc.text("HOMOLOGACION - SIN VALIDEZ FISCAL", 28, 212, { angle: 35 });
    doc.restoreGraphicsState(); doc.setTextColor(0, 0, 0);
  }

  return `${title === "FACTURA" ? "factura" : title === "NOTA DE CRÉDITO" ? "nota-credito" : "nota-debito"}-${isA ? "A" : "B"}-${data.number}.pdf`;
}

/** Arma el PDF en el navegador, con el QR de ARCA, y lo descarga. */
export async function downloadFiscalInvoicePdf(data: FiscalInvoicePdfData) {
  const [pointOfSale, sequence] = data.number.split("-").map(Number);
  const qrUrl = arcaQrUrl({
    issueDate: new Date(data.issueDate).toISOString(), companyCuit: companyOf(data.company).cuit, pointOfSale, voucherCode: ARCA_VOUCHER_CODE[data.voucherType],
    number: sequence, amountCents: data.amountCents, clientCuit: data.client.cuit, cae: data.cae,
  });
  const [{ jsPDF }, QRCode, logo] = await Promise.all([import("jspdf"), import("qrcode"), readPdfLogo()]);
  const qr = await QRCode.toDataURL(qrUrl, { margin: 0, width: 360, errorCorrectionLevel: "M" });
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.save(buildFiscalInvoicePdf(doc, data, { logo, qr }));
}
