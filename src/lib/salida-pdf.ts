import type { jsPDF } from "jspdf";
import { dateTime, money, qty } from "./format";
import { drawFooter, drawLetterhead, INK, LINE, MUTED, NAVY, PAGE, plain, RED, readPdfLogo, type Rgb } from "./pdf-brand";
import { warehouseLabel, WAREHOUSES } from "./warehouses";
import type { TicketData } from "./ticket-print";

/**
 * El detalle de una salida a obra hecha por la Caja (comprobante CJ-…): todos
 * los materiales que se llevaron, de qué depósito salió cada uno, con qué
 * remito, y lo que cuesta cada renglón y el total que se carga a la obra. Es un
 * papel interno, para Compras y la obra: el remito que acompaña al material es
 * el otro, sin precios (src/lib/remito-pdf.ts).
 */

export type SalidaPdfData = TicketData & { quoteNumber?: string };

const { margin: MARGIN, width: WIDTH, bottom: BOTTOM } = PAGE;
const INNER = WIDTH - MARGIN * 2;
const short = (key: string) => WAREHOUSES.find(entry => entry.key === key)?.short || warehouseLabel(key);

export function buildSalidaPdf(doc: jsPDF, data: SalidaPdfData, meta: { author: string; logo?: string }) {
  const setColor = ([r, g, b]: Rgb) => doc.setTextColor(r, g, b);
  const setFill = ([r, g, b]: Rgb) => doc.setFillColor(r, g, b);
  const setStroke = ([r, g, b]: Rgb) => doc.setDrawColor(r, g, b);
  let page = 1;
  let y = 0;

  function clip(text: string, maxWidth: number) {
    const clean = plain(text);
    if (doc.getTextWidth(clean) <= maxWidth) return clean;
    let cut = clean;
    while (cut.length > 3 && doc.getTextWidth(`${cut}...`) > maxWidth) cut = cut.slice(0, -1);
    return `${cut}...`;
  }

  const remitos = data.remitos || [];
  function header() {
    y = drawLetterhead(doc, {
      title: "Salida a obra", number: `N° ${data.number}`, logo: meta.logo,
      lines: [`Fecha: ${dateTime(data.createdAt || data.date)} hs`, remitos.length ? `Remito${remitos.length === 1 ? "" : "s"}: ${remitos.map(remito => remito.number).join(", ")}` : "Documento interno"],
    });
  }

  const col = { code: MARGIN + 3, product: MARGIN + 27, qty: 122, unit: 126, cost: 168, total: WIDTH - MARGIN - 3 };
  function tableHead() {
    setFill([237, 241, 246]);
    doc.rect(MARGIN, y - 5, INNER, 8, "F");
    setColor(MUTED); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
    doc.text("CÓDIGO", col.code, y);
    doc.text("MATERIAL", col.product, y);
    doc.text("CANT.", col.qty, y, { align: "right" });
    doc.text("UNIDAD", col.unit, y);
    doc.text("COSTO UNIT.", col.cost, y, { align: "right" });
    doc.text("SUBTOTAL", col.total, y, { align: "right" });
    y += 8;
  }

  function ensure(space: number, withTableHead = false) {
    if (y + space <= BOTTOM) return;
    drawFooter(doc, { page, author: meta.author, note: "Salida a obra, documento interno" });
    doc.addPage();
    page += 1;
    header();
    if (withTableHead) tableHead();
  }

  header();

  // Desde dónde y a qué obra.
  const boxTop = y;
  const boxHeight = 28;
  setStroke(LINE);
  doc.setLineWidth(0.4);
  doc.roundedRect(MARGIN, boxTop, INNER, boxHeight, 2, 2);
  doc.line(WIDTH / 2, boxTop, WIDTH / 2, boxTop + boxHeight);
  const block = (x: number, title: string, heading: string, detail: string[]) => {
    setColor(RED); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
    doc.text(title, x, boxTop + 7);
    setColor(NAVY); doc.setFontSize(10.5);
    doc.text(clip(heading, INNER / 2 - 12), x, boxTop + 13.5);
    setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.6);
    detail.forEach((line, index) => doc.text(clip(line, INNER / 2 - 12), x, boxTop + 19 + index * 4.2));
  };
  const used = remitos.length ? remitos : [...new Set(data.lines.flatMap(line => (line.parts || []).map(part => part.warehouse)))].map(warehouse => ({ warehouse, number: "" }));
  block(MARGIN + 5, "SALE DE", used.map(entry => warehouseLabel(entry.warehouse)).join(" y ") || "Depósito",
    used.map(entry => entry.number ? `${warehouseLabel(entry.warehouse)}: remito ${entry.number}` : "").filter(Boolean).slice(0, 2));
  block(WIDTH / 2 + 6, "SE ENTREGA EN", data.destinationLabel || "Obra", [`Cotización: ${data.quoteNumber || "-"}`, `Preparó: ${data.userName || meta.author}`]);
  y = boxTop + boxHeight + 10;

  setColor(RED); doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
  doc.text("MATERIALES ENTREGADOS", MARGIN, y);
  setColor(NAVY); doc.setFontSize(11.5);
  const units = data.lines.reduce((total, line) => total + Number(line.quantity || 0), 0);
  doc.text(plain(`${data.lines.length} ${data.lines.length === 1 ? "material" : "materiales"} · ${qty(units)} unidades`), MARGIN, y + 6);
  y += 14;
  tableHead();

  data.lines.forEach((line, index) => {
    // Si salió de los dos depósitos, abajo del nombre dice cuánto de cada uno.
    const parts = (line.parts || []).filter(part => part.quantity > 0);
    const split = parts.length > 1;
    // El nombre entero, en hasta tres renglones: los materiales suelen tener nombres largos.
    const nameWidth = col.qty - col.product - 14;
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.2);
    const nameLines = (doc.splitTextToSize(plain(line.name), nameWidth) as string[]).slice(0, 3);
    const extra = (nameLines.length - 1) * 4;
    const height = (split ? 10.5 : 7.4) + extra;
    ensure(height + 2, true);
    if (index % 2 === 1) { setFill([250, 251, 253]); doc.rect(MARGIN, y - 4.6, INNER, height, "F"); }
    setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.6);
    doc.text(clip(line.barcode || line.sku || "-", col.product - col.code - 3), col.code, y);
    setColor(INK); doc.setFont("helvetica", "bold"); doc.setFontSize(8.2);
    nameLines.forEach((text, lineIndex) => doc.text(text, col.product, y + lineIndex * 4));
    doc.text(plain(qty(Number(line.quantity || 0))), col.qty, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.text(clip(line.unit, col.cost - col.unit - 22), col.unit, y);
    doc.text(plain(money(Number(line.unitCostCents || 0))), col.cost, y, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(plain(money(Number(line.totalCents || 0))), col.total, y, { align: "right" });
    if (split) {
      setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
      doc.text(clip(`Sale ${parts.map(part => `${qty(part.quantity)} del ${short(part.warehouse)}${part.remito ? ` (${part.remito})` : ""}`).join(" y ")}`, nameWidth), col.product, y + 4 + extra);
    }
    y += height;
  });
  setFill(LINE);
  doc.rect(MARGIN, y - 2, INNER, 0.4, "F");
  y += 8;

  // El total que se carga a la obra.
  ensure(52);
  const totalWidth = 92;
  const totalX = WIDTH - MARGIN - totalWidth;
  setFill([248, 250, 252]);
  doc.roundedRect(totalX, y - 6, totalWidth, 17, 2, 2, "F");
  setColor(NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("COSTO TOTAL A LA OBRA", totalX + 5, y + 3.5);
  doc.setFontSize(11.5);
  doc.text(plain(money(Number(data.totalCents || 0))), WIDTH - MARGIN - 5, y + 3.5, { align: "right" });

  // A la izquierda: de dónde sale el costo y las observaciones.
  const noteWidth = totalX - MARGIN - 8;
  const notes = [
    "Costo al promedio ponderado de cada material al momento de la salida, sin IVA. No es una venta: se carga como costo de la obra.",
    ...(data.note?.trim() ? [`Observaciones: ${data.note.trim()}`] : []),
  ];
  setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.4);
  let noteY = y - 2;
  for (const text of notes.flatMap(note => doc.splitTextToSize(plain(note), noteWidth) as string[]).slice(0, 8)) { doc.text(text, MARGIN, noteY); noteY += 4.2; }
  y = Math.max(y + 20, noteY + 4);

  // Las firmas, al pie de la última hoja.
  ensure(30);
  const signY = Math.max(y + 22, 258);
  setStroke([150, 160, 172]);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, signY, MARGIN + 70, signY);
  doc.line(WIDTH - MARGIN - 70, signY, WIDTH - MARGIN, signY);
  setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.6);
  doc.text("Entregó (firma y aclaración)", MARGIN + 35, signY + 4.5, { align: "center" });
  doc.text("Recibió en obra (firma, aclaración y DNI)", WIDTH - MARGIN - 35, signY + 4.5, { align: "center" });

  drawFooter(doc, { page, author: meta.author, note: "Salida a obra, documento interno" });
  return `salida-a-obra-${data.number}.pdf`;
}

export async function downloadSalidaPdf(data: SalidaPdfData) {
  const [{ jsPDF }, logo, session] = await Promise.all([
    import("jspdf"),
    readPdfLogo(),
    fetch("/api/auth/me").then(response => response.ok ? response.json() : null).catch(() => null),
  ]);
  const doc = new jsPDF();
  const filename = buildSalidaPdf(doc, data, { author: session?.name || data.userName || "el sistema", logo });
  doc.save(filename);
}
