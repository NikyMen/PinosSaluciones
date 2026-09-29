import type { jsPDF } from "jspdf";
import { date, money } from "./format";
import { amountInWords, drawFooter, drawLetterhead, INK, LINE, MUTED, NAVY, PAGE, plain, RED, readPdfLogo, type Rgb } from "./pdf-brand";
import type { ReceiptPdfData } from "./receipt-service";

/**
 * Recibo de cobro: de quién se recibe, cuánto (también en letras), qué facturas
 * cancela y cuánto a cada una, y con qué se pagó. Abajo firma quien recibe.
 */

const { margin: MARGIN, width: WIDTH, bottom: BOTTOM } = PAGE;
const INNER = WIDTH - MARGIN * 2;

export const methodLabels: Record<string, string> = { transferencia: "Transferencia", efectivo: "Efectivo", cheque: "Cheque", retencion: "Retención", otro: "Otro" };

export function buildReceiptPdf(doc: jsPDF, data: ReceiptPdfData, meta: { author: string; logo?: string }) {
  const setColor = ([r, g, b]: Rgb) => doc.setTextColor(r, g, b);
  const setFill = ([r, g, b]: Rgb) => doc.setFillColor(r, g, b);
  const setStroke = ([r, g, b]: Rgb) => doc.setDrawColor(r, g, b);
  let page = 1;
  const header = () => drawLetterhead(doc, {
    title: "Recibo", number: `N° ${data.number}`, logo: meta.logo,
    lines: [`Fecha: ${date(data.date)}`, "Documento no válido como factura"],
  });
  let y = header();

  // De quién se recibe.
  setStroke(LINE);
  doc.setLineWidth(0.4);
  doc.roundedRect(MARGIN, y, INNER, 24, 2, 2);
  setColor(RED); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
  doc.text("RECIBIMOS DE", MARGIN + 5, y + 7);
  setColor(NAVY); doc.setFontSize(11.5);
  doc.text(plain(data.client.name), MARGIN + 5, y + 14);
  setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.8);
  doc.text(plain([data.client.cuit && `CUIT ${data.client.cuit}`, data.client.address].filter(Boolean).join(" · ") || "-"), MARGIN + 5, y + 20);
  y += 32;

  // La suma, en número y en letras.
  setColor(INK); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text("La suma de:", MARGIN, y);
  doc.setFontSize(13);
  setColor(NAVY);
  doc.text(plain(money(data.totalCents)), WIDTH - MARGIN, y, { align: "right" });
  y += 6;
  setColor(INK); doc.setFont("helvetica", "normal"); doc.setFontSize(8.4);
  for (const line of (doc.splitTextToSize(plain(amountInWords(data.totalCents)), INNER) as string[]).slice(0, 2)) { doc.text(line, MARGIN, y); y += 4.6; }
  y += 6;

  // Las facturas que cancela.
  setFill([237, 241, 246]);
  doc.rect(MARGIN, y - 5, INNER, 8, "F");
  setColor(MUTED); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
  doc.text("COMPROBANTE", MARGIN + 3, y);
  doc.text("FECHA", 92, y);
  doc.text("COTIZACIÓN", 116, y);
  doc.text("IMPORTE", 164, y, { align: "right" });
  doc.text("APLICADO", WIDTH - MARGIN - 3, y, { align: "right" });
  y += 8;
  const lines = data.lines.length ? data.lines : [{ label: "Pago a cuenta", issueDate: null, invoiceCents: 0, appliedCents: data.totalCents, quoteNumber: "" }];
  lines.forEach((line, index) => {
    if (y > BOTTOM - 70) { drawFooter(doc, { page, author: meta.author }); doc.addPage(); page += 1; y = header() + 6; }
    if (index % 2 === 1) { setFill([250, 251, 253]); doc.rect(MARGIN, y - 4.6, INNER, 7.4, "F"); }
    setColor(INK); doc.setFont("helvetica", "bold"); doc.setFontSize(8.4);
    doc.text(plain(line.label).slice(0, 44), MARGIN + 3, y);
    doc.setFont("helvetica", "normal"); setColor(MUTED); doc.setFontSize(7.8);
    doc.text(line.issueDate ? date(line.issueDate) : "-", 92, y);
    doc.text(plain(line.quoteNumber || "-"), 116, y);
    doc.text(line.invoiceCents ? plain(money(line.invoiceCents)) : "-", 164, y, { align: "right" });
    setColor(INK); doc.setFont("helvetica", "bold"); doc.setFontSize(8.4);
    doc.text(plain(money(line.appliedCents)), WIDTH - MARGIN - 3, y, { align: "right" });
    y += 7.4;
  });
  setFill(LINE);
  doc.rect(MARGIN, y - 2, INNER, 0.4, "F");
  y += 5;
  setColor(NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
  doc.text("TOTAL RECIBIDO", 120, y);
  doc.text(plain(money(data.totalCents)), WIDTH - MARGIN - 3, y, { align: "right" });
  y += 12;

  // Con qué se pagó.
  setColor(INK); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  doc.text("Forma de pago:", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.text(plain([methodLabels[data.method] || data.method, data.account, data.reference && `Ref. ${data.reference}`].filter(Boolean).join(" · ")), MARGIN + 25, y);
  y += 6;
  if (data.notes.trim()) {
    setColor(MUTED); doc.setFontSize(7.8);
    for (const line of (doc.splitTextToSize(plain(`Observaciones: ${data.notes.trim()}`), INNER) as string[]).slice(0, 4)) { doc.text(line, MARGIN, y); y += 4.4; }
  }

  // La firma de quien recibe, al pie.
  const signY = Math.max(y + 24, 258);
  setStroke([150, 160, 172]);
  doc.setLineWidth(0.3);
  doc.line(WIDTH - MARGIN - 75, signY, WIDTH - MARGIN, signY);
  setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.6);
  doc.text("Recibí conforme (firma y aclaración)", WIDTH - MARGIN - 37.5, signY + 4.5, { align: "center" });
  doc.text(plain(`Emitió: ${data.userName || meta.author}`), MARGIN, signY + 4.5);

  drawFooter(doc, { page, author: meta.author, note: "Recibo de cobro" });
  return `recibo-${data.number}.pdf`;
}

/** Arma el PDF del recibo en el navegador y lo descarga. */
export async function downloadReceiptPdf(data: ReceiptPdfData) {
  const [{ jsPDF }, logo, session] = await Promise.all([
    import("jspdf"),
    readPdfLogo(),
    fetch("/api/auth/me").then(response => response.ok ? response.json() : null).catch(() => null),
  ]);
  const doc = new jsPDF();
  const filename = buildReceiptPdf(doc, data, { author: session?.name || data.userName || "el sistema", logo });
  doc.save(filename);
}
