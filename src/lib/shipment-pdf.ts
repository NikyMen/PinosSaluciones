import type { jsPDF } from "jspdf";
import { date, money, qty } from "./format";
import { drawFooter, drawLetterhead, INK, LINE, MUTED, NAVY, PAGE, plain, RED, readPdfLogo, type Rgb } from "./pdf-brand";
import { COMPANIES, companyOf } from "./companies";
import { warehouseLabel } from "./warehouses";

/**
 * Remito de envío por transporte: el papel que pide el transporte (Expreso
 * Demonte, Correo Argentino) con el valor declarado. Lleva el precio de cada
 * renglón y el total declarado; abajo firman quien entrega y el transporte.
 */

export type ShipmentPdfData = {
  number: string; sentAt: string; company?: string; from: string; destination: string; receiver?: string;
  carrier: string; packages?: number; pallets?: number; workLabel?: string; salesRemitoNumber?: string; note?: string; sentByName?: string;
  trackingNumber?: string; declaredCents: number;
  lines: Array<{ code?: string; name: string; unit: string; quantity: number; declaredUnitCents: number; declaredCents: number }>;
};

const { margin: MARGIN, width: WIDTH, bottom: BOTTOM } = PAGE;
const INNER = WIDTH - MARGIN * 2;

export function buildShipmentPdf(doc: jsPDF, data: ShipmentPdfData, meta: { author: string; logo?: string }) {
  const setColor = ([r, g, b]: Rgb) => doc.setTextColor(r, g, b);
  const setFill = ([r, g, b]: Rgb) => doc.setFillColor(r, g, b);
  const setStroke = ([r, g, b]: Rgb) => doc.setDrawColor(r, g, b);
  const company = COMPANIES[companyOf(data.company).key];
  let page = 1;

  const header = () => drawLetterhead(doc, {
    title: "Remito de envío", number: `N° ${data.number}`, logo: meta.logo, company,
    lines: [`Fecha: ${date(data.sentAt)}`, "Documento no válido como factura"],
  });
  let y = header();

  // Desde dónde, hacia dónde y con qué transporte.
  const boxTop = y;
  setStroke(LINE);
  doc.setLineWidth(0.4);
  doc.roundedRect(MARGIN, boxTop, INNER, 30, 2, 2);
  doc.line(WIDTH / 2, boxTop, WIDTH / 2, boxTop + 30);
  const block = (x: number, title: string, heading: string, details: string[]) => {
    setColor(RED); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
    doc.text(title, x, boxTop + 7);
    setColor(NAVY); doc.setFontSize(10.5);
    doc.text((doc.splitTextToSize(plain(heading), INNER / 2 - 10) as string[])[0], x, boxTop + 14);
    setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.8);
    details.filter(Boolean).slice(0, 2).forEach((detail, index) => doc.text((doc.splitTextToSize(plain(detail), INNER / 2 - 10) as string[])[0], x, boxTop + 20 + index * 4.6));
  };
  block(MARGIN + 5, "SALE DE", warehouseLabel(data.from), [company.legalName, data.workLabel ? `Obra: ${data.workLabel}` : data.salesRemitoNumber ? `Remito de venta ${data.salesRemitoNumber}` : ""]);
  block(WIDTH / 2 + 6, "VA A", data.destination, [data.receiver ? `Recibe o retira: ${data.receiver}` : "", data.note || ""]);
  y = boxTop + 38;

  // El transporte.
  setFill([244, 247, 250]);
  doc.roundedRect(MARGIN, y - 5, INNER, 10, 2, 2, "F");
  setColor(MUTED); doc.setFont("helvetica", "bold"); doc.setFontSize(7.2);
  const transport = [`TRANSPORTE: ${data.carrier}`, data.packages ? `BULTOS: ${data.packages}` : "", data.pallets ? `PALLETS: ${data.pallets}` : "", data.trackingNumber ? `GUÍA: ${data.trackingNumber}` : ""].filter(Boolean).join("     ");
  setColor(INK);
  doc.text(plain(transport), MARGIN + 4, y + 1.2);
  y += 13;

  // Los materiales con su valor declarado.
  const cols = { code: MARGIN + 3, name: MARGIN + 26, unit: 112, qty: 138, price: 166, total: WIDTH - MARGIN - 3 };
  setFill([237, 241, 246]);
  doc.rect(MARGIN, y - 5, INNER, 8, "F");
  setColor(MUTED); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
  doc.text("CÓDIGO", cols.code, y);
  doc.text("MATERIAL", cols.name, y);
  doc.text("UNIDAD", cols.unit, y);
  doc.text("CANTIDAD", cols.qty, y, { align: "right" });
  doc.text("P. UNITARIO", cols.price, y, { align: "right" });
  doc.text("SUBTOTAL", cols.total, y, { align: "right" });
  y += 8;
  data.lines.forEach((line, index) => {
    if (y > BOTTOM - 62) { drawFooter(doc, { page, author: meta.author, company }); doc.addPage(); page += 1; y = header() + 6; }
    if (index % 2 === 1) { setFill([250, 251, 253]); doc.rect(MARGIN, y - 4.6, INNER, 7.4, "F"); }
    setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.6);
    doc.text(plain(line.code || "-").slice(0, 14), cols.code, y);
    setColor(INK); doc.setFont("helvetica", "bold"); doc.setFontSize(8.2);
    doc.text((doc.splitTextToSize(plain(line.name), cols.unit - cols.name - 3) as string[])[0], cols.name, y);
    doc.setFont("helvetica", "normal");
    doc.text(plain(line.unit), cols.unit, y);
    doc.text(plain(qty(line.quantity)), cols.qty, y, { align: "right" });
    doc.text(plain(money(line.declaredUnitCents)), cols.price, y, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(plain(money(line.declaredCents)), cols.total, y, { align: "right" });
    y += 7.4;
  });
  setFill(LINE);
  doc.rect(MARGIN, y - 2, INNER, 0.4, "F");
  y += 6;
  setColor(NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("VALOR DECLARADO", cols.price, y, { align: "right" });
  doc.text(plain(money(data.declaredCents)), cols.total, y, { align: "right" });
  y += 8;

  setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.4);
  doc.text(plain(`Preparó: ${data.sentByName || meta.author}`), MARGIN, y);

  // Firmas: quien entrega y el transporte que lo recibe.
  const signY = 258;
  setStroke([150, 160, 172]);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, signY, MARGIN + 70, signY);
  doc.line(WIDTH - MARGIN - 70, signY, WIDTH - MARGIN, signY);
  setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.6);
  doc.text("Entregó (firma y aclaración)", MARGIN + 35, signY + 4.5, { align: "center" });
  doc.text("Recibió el transporte (firma, aclaración y DNI)", WIDTH - MARGIN - 35, signY + 4.5, { align: "center", maxWidth: 70 });

  drawFooter(doc, { page, author: meta.author, company, note: "Remito de envío, sin valor comercial" });
  return `remito-envio-${data.number}.pdf`;
}

export async function downloadShipmentPdf(data: ShipmentPdfData) {
  const [{ jsPDF }, logo, session] = await Promise.all([
    import("jspdf"),
    readPdfLogo(),
    fetch("/api/auth/me").then(response => response.ok ? response.json() : null).catch(() => null),
  ]);
  const doc = new jsPDF();
  const filename = buildShipmentPdf(doc, data, { author: session?.name || data.sentByName || "el sistema", logo });
  doc.save(filename);
}
