import type { jsPDF } from "jspdf";
import { date, money } from "./format";
import { amountInWords, drawFooter, drawLetterhead, INK, LINE, MUTED, NAVY, PAGE, plain, RED, readPdfLogo, type Rgb } from "./pdf-brand";
import { companyOf, type CompanyKey } from "./companies";

/**
 * Orden de pago en PDF (requerimiento integral v4, puntos 3 y 5): a quién se le
 * paga, cuánto (también en letras), qué paga (la orden de compra, la factura),
 * con qué y de qué cuenta. Si es en efectivo, lleva la constancia de entrega
 * para que la firme quien recibe la plata.
 */

export type PaymentOrderPdfData = {
  company: CompanyKey; number: string; date: string; dueDate?: string; status: string;
  supplier: { name: string; cuit?: string; bank?: string; cbu?: string; alias?: string };
  orderNumber?: string; requestNumber?: string; invoiceLabel?: string;
  amountCents: number; retentionsCents: number;
  method: string; cashAccount?: string; ledgerAccount?: string; reference?: string; notes?: string;
  paidAt?: string; paidByName?: string;
};

const { margin: MARGIN, width: WIDTH } = PAGE;
const INNER = WIDTH - MARGIN * 2;
const methodLabels: Record<string, string> = { transferencia: "Transferencia", efectivo: "Efectivo", cheque: "Cheque / eCheq", otro: "Otro" };
const statusLabels: Record<string, string> = { emitida: "Emitida, pendiente de pago", pagada: "Pagada", anulada: "ANULADA" };

export function buildPaymentOrderPdf(doc: jsPDF, data: PaymentOrderPdfData, meta: { author: string; logo?: string }) {
  const setColor = ([r, g, b]: Rgb) => doc.setTextColor(r, g, b);
  const setFill = ([r, g, b]: Rgb) => doc.setFillColor(r, g, b);
  const setStroke = ([r, g, b]: Rgb) => doc.setDrawColor(r, g, b);
  const company = companyOf(data.company);
  let y = drawLetterhead(doc, {
    title: "Orden de pago", number: `N° ${data.number}`, logo: meta.logo, company,
    lines: [`Fecha: ${date(data.date)}`, data.dueDate ? `Vencimiento: ${date(data.dueDate)}` : `Estado: ${statusLabels[data.status] || data.status}`],
  });

  // A quién se le paga.
  setStroke(LINE); doc.setLineWidth(0.4);
  doc.roundedRect(MARGIN, y, INNER, 26, 2, 2);
  setColor(RED); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
  doc.text("PÁGUESE A", MARGIN + 5, y + 7);
  setColor(NAVY); doc.setFontSize(11.5);
  doc.text(plain(data.supplier.name), MARGIN + 5, y + 14);
  setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.8);
  doc.text(plain([data.supplier.cuit && `CUIT ${data.supplier.cuit}`, data.supplier.bank, data.supplier.cbu && `CBU ${data.supplier.cbu}`, data.supplier.alias && `Alias ${data.supplier.alias}`].filter(Boolean).join(" · ") || "-"), MARGIN + 5, y + 20);
  y += 34;

  // Qué se paga.
  const rows: Array<[string, string]> = [
    ["Orden de compra", data.orderNumber || "-"],
    ["Solicitud", data.requestNumber || "-"],
    ["Factura", data.invoiceLabel || "Sin factura (contado o anticipo)"],
    ["Forma de pago", [methodLabels[data.method] || data.method, data.reference && `Ref. ${data.reference}`].filter(Boolean).join(" · ")],
    ["Sale de", data.cashAccount || "-"],
    ["Cuenta del plan", data.ledgerAccount || "-"],
  ];
  for (const [label, value] of rows) {
    setColor(MUTED); doc.setFont("helvetica", "bold"); doc.setFontSize(7.4);
    doc.text(plain(label.toUpperCase()), MARGIN, y);
    setColor(INK); doc.setFont("helvetica", "normal"); doc.setFontSize(8.8);
    doc.text(plain(value).slice(0, 90), MARGIN + 38, y);
    y += 6.4;
  }
  y += 4;

  // Los importes.
  setFill([248, 250, 252]);
  doc.roundedRect(MARGIN, y - 6, INNER, data.retentionsCents ? 30 : 22, 2, 2, "F");
  setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(8.4);
  doc.text("Importe de la orden", MARGIN + 5, y);
  doc.text(plain(money(data.amountCents)), WIDTH - MARGIN - 5, y, { align: "right" });
  if (data.retentionsCents) {
    y += 6;
    doc.text("Retenciones", MARGIN + 5, y);
    doc.text(plain(`- ${money(data.retentionsCents)}`), WIDTH - MARGIN - 5, y, { align: "right" });
  }
  const net = data.amountCents - data.retentionsCents;
  y += 9;
  setColor(NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("A PAGAR", MARGIN + 5, y);
  doc.text(plain(money(net)), WIDTH - MARGIN - 5, y, { align: "right" });
  y += 12;
  setColor(INK); doc.setFont("helvetica", "normal"); doc.setFontSize(8.2);
  for (const line of (doc.splitTextToSize(plain(`Son: ${amountInWords(net)}`), INNER) as string[]).slice(0, 2)) { doc.text(line, MARGIN, y); y += 4.6; }
  if (data.notes?.trim()) {
    y += 2; setColor(MUTED); doc.setFontSize(7.8);
    for (const line of (doc.splitTextToSize(plain(`Observaciones: ${data.notes.trim()}`), INNER) as string[]).slice(0, 4)) { doc.text(line, MARGIN, y); y += 4.4; }
  }
  if (data.paidAt) {
    y += 2; setColor(NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text(plain(`Pagada el ${date(data.paidAt)}${data.paidByName ? ` por ${data.paidByName}` : ""}`), MARGIN, y);
  }

  // Firmas: quien autoriza el pago y, en efectivo, quien recibe la plata.
  const signY = Math.max(y + 30, 236);
  setStroke([150, 160, 172]); doc.setLineWidth(0.3);
  doc.line(MARGIN, signY, MARGIN + 70, signY);
  setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.6);
  doc.text("Autorizó (Tesorería)", MARGIN + 35, signY + 4.5, { align: "center" });
  if (data.method === "efectivo") {
    doc.line(WIDTH - MARGIN - 80, signY, WIDTH - MARGIN, signY);
    doc.text("Recibí conforme el efectivo: firma", WIDTH - MARGIN - 40, signY + 4.5, { align: "center" });
    doc.line(WIDTH - MARGIN - 80, signY + 16, WIDTH - MARGIN, signY + 16);
    doc.text("Aclaración, DNI y fecha", WIDTH - MARGIN - 40, signY + 20.5, { align: "center" });
  }
  if (data.status === "anulada") {
    setColor(RED); doc.setFont("helvetica", "bold"); doc.setFontSize(46);
    doc.text("ANULADA", WIDTH / 2, 160, { align: "center", angle: 20 });
  }
  drawFooter(doc, { page: 1, author: meta.author, note: "Orden de pago", company });
  return `orden-de-pago-${data.number}.pdf`;
}

export async function paymentOrderPdfBytes(data: PaymentOrderPdfData) {
  const [{ jsPDF }, logo, session] = await Promise.all([import("jspdf"), readPdfLogo(), fetch("/api/auth/me").then(response => response.ok ? response.json() : null).catch(() => null)]);
  const doc = new jsPDF();
  const filename = buildPaymentOrderPdf(doc, data, { author: session?.name || "el sistema", logo });
  return { filename, bytes: new Uint8Array(doc.output("arraybuffer")) };
}

/** Arma el PDF de la orden de pago en el navegador y lo descarga. */
export async function downloadPaymentOrderPdf(data: PaymentOrderPdfData) {
  const { filename, bytes } = await paymentOrderPdfBytes(data);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
