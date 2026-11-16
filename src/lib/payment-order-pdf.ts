import type { jsPDF } from "jspdf";
import type { Signature } from "./document-signatures";
import { date, money } from "./format";
import { amountInWords, drawFooter, drawLetterhead, INK, LINE, MUTED, NAVY, PAGE, plain, RED, readPdfLogo, type Rgb } from "./pdf-brand";
import { companyOf, type CompanyKey } from "./companies";
import { cashMethodLabels } from "./cash-methods";

/**
 * Orden de pago en PDF (requerimiento integral v4, puntos 3 y 5): a quién se le
 * paga, cuánto (también en letras), qué paga (la orden de compra, la factura o
 * el detalle de las facturas, con lo que se paga de cada una y las notas de
 * crédito que se descuentan), con qué y de qué cuenta. Si es en efectivo, lleva
 * la constancia de entrega para que la firme quien recibe la plata.
 */

export type PaymentOrderPdfData = {
  signature?: Signature;
  company: CompanyKey; number: string; date: string; dueDate?: string; status: string;
  supplier: { name: string; cuit?: string; bank?: string; cbu?: string; alias?: string };
  orderNumber?: string; requestNumber?: string; invoiceLabel?: string;
  /** Los comprobantes que paga, cuando son varios o alguno se paga en parte. */
  lines?: Array<{ label: string; issueDate?: string; totalCents: number; appliedCents: number; credit: boolean }>;
  workLabel?: string;
  amountCents: number; retentionsCents: number;
  /** Lo que se paga sin factura: queda a cuenta del proveedor. */
  onAccountCents?: number;
  method: string; cashAccount?: string; ledgerAccount?: string; reference?: string; notes?: string;
  check?: { number: string; bank: string; dueDate?: string; electronic: boolean };
  /** Con qué se paga, cuando son varios medios: cada uno con su cuenta, su importe y el cheque si es uno. */
  media?: Array<{
    method: string; account: string; amountCents: number; detail?: string;
    /** El número entero del cheque o de la transferencia, el banco (nombre corto) y la fecha de pago (la de cobro, en un cheque). */
    number?: string; bank?: string; paidOn?: string; attachment?: string;
  }>;
  /** Los comprobantes de los medios: van detrás de la OP en el PDF que se baja. */
  attachments?: Array<{ path: string; name?: string }>;
  paidAt?: string; paidByName?: string;
};

const { margin: MARGIN, width: WIDTH } = PAGE;
const INNER = WIDTH - MARGIN * 2;
export const paymentMethodLabels = cashMethodLabels;
const methodLabels = paymentMethodLabels;
const statusLabels: Record<string, string> = { emitida: "Emitida, pendiente de pago", pagada: "Pagada", anulada: "ANULADA" };

/** Un medio en la línea de "Forma de pago": medio y número, banco, importe y fecha de pago. */
function mediumLine(medium: NonNullable<PaymentOrderPdfData["media"]>[number], data: PaymentOrderPdfData) {
  const label = methodLabels[medium.method] || medium.method;
  const number = medium.method === "efectivo" ? "" : String(medium.number || "").trim();
  const bank = medium.method === "efectivo" ? "" : String(medium.bank || "").trim();
  const paidOn = medium.paidOn || data.date;
  return [number ? `${label} N° ${number}` : label, bank, money(medium.amountCents), paidOn && `Fecha de pago: ${date(paidOn)}`].filter(Boolean).join(" - ");
}

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
    ...(data.lines ? [] : [["Factura", data.invoiceLabel || (data.onAccountCents ? "Sin factura: a cuenta" : "Sin factura (contado o anticipo)")] as [string, string]]),
    // Cada medio en su renglón: "e-Cheq N° 12042030 - Banco Corrientes - $ 231.000,00 - Fecha de pago: 18/12/2026"
    // (Administración, noviembre 2026). Lo que el medio no tiene (el efectivo no tiene número ni banco) no va.
    ...(data.media?.length
      // El nombre interno de la cuenta ("Cheques diferidos … Sub-Cuenta 2") no va: el proveedor ve el banco.
      ? data.media.map((medium, index) => [index ? "" : "Forma de pago", mediumLine(medium, data)] as [string, string])
      : [
        ["Forma de pago", [methodLabels[data.method] || data.method, data.reference && `Ref. ${data.reference}`].filter(Boolean).join(" · ")] as [string, string],
        ...(data.check ? [[data.check.electronic ? "e-Cheq" : "Cheque", [`N° ${data.check.number}`, data.check.bank, data.check.dueDate && `cobro ${date(data.check.dueDate)}`].filter(Boolean).join(" · ")] as [string, string]] : []),
        ["Sale de", data.cashAccount || "-"] as [string, string],
      ]),
    ["Tipo de gasto", data.ledgerAccount || "-"],
    ...(data.workLabel ? [["Obra", data.workLabel] as [string, string]] : []),
  ];
  for (const [label, value] of rows) {
    setColor(MUTED); doc.setFont("helvetica", "bold"); doc.setFontSize(7.4);
    doc.text(plain(label.toUpperCase()), MARGIN, y);
    setColor(INK); doc.setFont("helvetica", "normal"); doc.setFontSize(8.8);
    // Lo largo baja de renglón: no se corta (el número del cheque tiene que ir entero).
    const wrapped = doc.splitTextToSize(plain(value), INNER - 38) as string[];
    wrapped.forEach((line, index) => doc.text(line, MARGIN + 38, y + index * 4.4));
    y += 6.4 + (wrapped.length - 1) * 4.4;
  }
  y += 4;

  // Qué comprobantes paga y cuánto de cada uno; las notas de crédito restan.
  if (data.lines?.length) {
    const columns = [MARGIN + 2, MARGIN + 92, WIDTH - MARGIN - 52, WIDTH - MARGIN - 2];
    setFill([241, 245, 249]); doc.rect(MARGIN, y - 4.5, INNER, 6.5, "F");
    setColor(MUTED); doc.setFont("helvetica", "bold"); doc.setFontSize(7.2);
    doc.text("COMPROBANTE", columns[0], y); doc.text("FECHA", columns[1], y);
    doc.text("TOTAL", columns[2], y, { align: "right" }); doc.text("SE PAGA", columns[3], y, { align: "right" });
    y += 6;
    setColor(INK); doc.setFont("helvetica", "normal"); doc.setFontSize(8.2);
    for (const line of data.lines.slice(0, 18)) {
      doc.text(plain(line.label).slice(0, 52), columns[0], y);
      doc.text(line.issueDate ? date(line.issueDate) : "-", columns[1], y);
      doc.text(plain(money(line.totalCents)), columns[2], y, { align: "right" });
      const partial = !line.credit && line.appliedCents < line.totalCents;
      doc.text(plain(`${line.credit ? "- " : ""}${money(line.appliedCents)}${partial ? " (parcial)" : ""}`), columns[3], y, { align: "right" });
      y += 5.4;
    }
    if (data.lines.length > 18) { setColor(MUTED); doc.text(plain(`y ${data.lines.length - 18} comprobantes más`), columns[0], y); y += 5.4; }
    y += 4;
  }

  // Los importes.
  setFill([248, 250, 252]);
  const onAccount = Number(data.onAccountCents || 0);
  doc.roundedRect(MARGIN, y - 6, INNER, 22 + (data.retentionsCents ? 8 : 0) + (onAccount ? 6 : 0), 2, 2, "F");
  setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(8.4);
  doc.text("Importe de la orden", MARGIN + 5, y);
  doc.text(plain(money(data.amountCents)), WIDTH - MARGIN - 5, y, { align: "right" });
  if (onAccount) {
    y += 6;
    doc.text("De eso, a cuenta (sin factura)", MARGIN + 5, y);
    doc.text(plain(money(onAccount)), WIDTH - MARGIN - 5, y, { align: "right" });
  }
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
  doc.text(plain(data.signature?.name || "Autorizó (Tesorería)"), MARGIN + 35, signY + 4.5, { align: "center", maxWidth: 70 });
  if (data.signature) doc.text(plain(data.signature.title), MARGIN + 35, signY + 9, { align: "center", maxWidth: 70 });
  if (data.method === "efectivo" || data.media?.some(medium => medium.method === "efectivo")) {
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

const A4: [number, number] = [595.28, 841.89];

/** Qué es un archivo por sus primeros bytes (una foto con la extensión cambiada sigue siendo lo que es). */
function sniff(bytes: Uint8Array) {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  return "";
}

/** Una foto que pdf-lib no lee (WebP) pasa a JPEG con el navegador. */
async function toJpeg(bytes: Uint8Array, type: string) {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Sin canvas");
  context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("No se pudo convertir la foto");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * La OP con los comprobantes de sus medios detrás (Administración, noviembre
 * 2026): al proveedor le llega todo en un solo PDF. Los PDF van página por
 * página y cada foto en su hoja, achicada para que entre. Un comprobante que no
 * se puede leer se saltea: la OP sale igual.
 */
export async function paymentOrderPdfWithAttachments(data: PaymentOrderPdfData) {
  const base = await paymentOrderPdfBytes(data);
  const files = (data.attachments || []).filter(file => file.path);
  if (!files.length) return base;
  try {
    const { PDFDocument } = await import("pdf-lib");
    const merged = await PDFDocument.load(base.bytes);
    let added = 0;
    for (const file of files) {
      try {
        const response = await fetch(file.path);
        if (!response.ok) continue;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const kind = sniff(bytes);
        if (kind === "pdf") {
          const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
          for (const page of await merged.copyPages(source, source.getPageIndices())) merged.addPage(page);
          added++;
        } else if (kind) {
          const image = kind === "png" ? await merged.embedPng(bytes) : await merged.embedJpg(kind === "jpg" ? bytes : await toJpeg(bytes, `image/${kind}`));
          const [width, height] = A4;
          const page = merged.addPage(A4);
          const scale = Math.min((width - 60) / image.width, (height - 60) / image.height, 1);
          page.drawImage(image, { x: (width - image.width * scale) / 2, y: (height - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
          added++;
        }
      } catch { /* este comprobante no se pudo leer: se saltea */ }
    }
    return added ? { filename: base.filename, bytes: await merged.save() } : base;
  } catch { return base; }
}

/** Arma el PDF de la orden de pago en el navegador, con los comprobantes de los medios detrás, y lo descarga. */
export async function downloadPaymentOrderPdf(data: PaymentOrderPdfData) {
  const { filename, bytes } = await paymentOrderPdfWithAttachments(data);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
