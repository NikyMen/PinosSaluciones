import type { jsPDF } from "jspdf";
import { date, qty } from "./format";
import { drawFooter, drawLetterhead, INK, LINE, MUTED, NAVY, PAGE, plain, RED, readPdfLogo, type Rgb } from "./pdf-brand";
import { warehouseLabel } from "./warehouses";

/**
 * Remito interno: el papel que acompaña al material cuando sale de un depósito,
 * a una obra o al otro depósito. No es una venta: no lleva precios. Abajo van
 * las firmas de quien entrega y de quien recibe.
 */

export type RemitoData = {
  number: string;
  date: string;
  kind: "egreso" | "transferencia";
  fromWarehouse: string;
  /** A dónde va: "Obra OB-99 · Fachada" o el depósito de destino. */
  destination: string;
  quoteNumber?: string;
  items: Array<{ code?: string; name: string; unit: string; quantity: number }>;
  note?: string;
  userName?: string;
};

const { margin: MARGIN, width: WIDTH, bottom: BOTTOM } = PAGE;
const INNER = WIDTH - MARGIN * 2;

export function buildRemitoPdf(doc: jsPDF, data: RemitoData, meta: { author: string; logo?: string }) {
  const setColor = ([r, g, b]: Rgb) => doc.setTextColor(r, g, b);
  const setFill = ([r, g, b]: Rgb) => doc.setFillColor(r, g, b);
  const setStroke = ([r, g, b]: Rgb) => doc.setDrawColor(r, g, b);
  let page = 1;

  const header = () => drawLetterhead(doc, {
    title: data.kind === "egreso" ? "Remito de entrega" : "Remito de transferencia", number: `N° ${data.number}`, logo: meta.logo,
    lines: [`Fecha: ${date(data.date)}`, "Documento no válido como factura"],
  });
  let y = header();

  // Desde dónde y hacia dónde.
  const boxTop = y;
  setStroke(LINE);
  doc.setLineWidth(0.4);
  doc.roundedRect(MARGIN, boxTop, INNER, 26, 2, 2);
  doc.line(WIDTH / 2, boxTop, WIDTH / 2, boxTop + 26);
  const block = (x: number, title: string, heading: string, detail: string) => {
    setColor(RED); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
    doc.text(title, x, boxTop + 7);
    setColor(NAVY); doc.setFontSize(11);
    doc.text(plain(heading), x, boxTop + 14);
    setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.8);
    doc.text(plain(detail), x, boxTop + 20);
  };
  block(MARGIN + 5, "SALE DE", data.fromWarehouse, "Depósito de origen");
  block(WIDTH / 2 + 6, data.kind === "egreso" ? "SE ENTREGA EN" : "VA AL DEPÓSITO", data.destination,
    data.kind === "egreso" ? `Cotización: ${data.quoteNumber || "-"}` : "Pase interno entre depósitos");
  y = boxTop + 36;

  // Los materiales, sin precios.
  setFill([237, 241, 246]);
  doc.rect(MARGIN, y - 5, INNER, 8, "F");
  setColor(MUTED); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
  doc.text("CÓDIGO", MARGIN + 3, y);
  doc.text("MATERIAL", MARGIN + 32, y);
  doc.text("UNIDAD", 150, y);
  doc.text("CANTIDAD", WIDTH - MARGIN - 3, y, { align: "right" });
  y += 8;
  data.items.forEach((item, index) => {
    if (y > BOTTOM - 60) { drawFooter(doc, { page, author: meta.author }); doc.addPage(); page += 1; y = header() + 6; }
    if (index % 2 === 1) { setFill([250, 251, 253]); doc.rect(MARGIN, y - 4.6, INNER, 7.4, "F"); }
    setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.8);
    doc.text(plain(item.code || "-"), MARGIN + 3, y);
    setColor(INK); doc.setFont("helvetica", "bold"); doc.setFontSize(8.4);
    doc.text(plain(item.name).slice(0, 70), MARGIN + 32, y);
    doc.setFont("helvetica", "normal");
    doc.text(plain(item.unit), 150, y);
    doc.setFont("helvetica", "bold");
    doc.text(plain(qty(item.quantity)), WIDTH - MARGIN - 3, y, { align: "right" });
    y += 7.4;
  });
  setFill(LINE);
  doc.rect(MARGIN, y - 2, INNER, 0.4, "F");
  y += 8;

  if (data.note?.trim()) {
    setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.8);
    for (const line of (doc.splitTextToSize(plain(`Observaciones: ${data.note.trim()}`), INNER) as string[]).slice(0, 4)) { doc.text(line, MARGIN, y); y += 4.4; }
  }
  setColor(MUTED); doc.setFontSize(7.4);
  doc.text(plain(`Preparó: ${data.userName || meta.author}`), MARGIN, y + 4);

  // Las firmas al pie: quien entrega y quien recibe (con aclaración y DNI).
  const signY = 258;
  setStroke([150, 160, 172]);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, signY, MARGIN + 70, signY);
  doc.line(WIDTH - MARGIN - 70, signY, WIDTH - MARGIN, signY);
  setColor(MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.6);
  doc.text("Entregó (firma y aclaración)", MARGIN + 35, signY + 4.5, { align: "center" });
  doc.text("Recibió conforme (firma, aclaración y DNI)", WIDTH - MARGIN - 35, signY + 4.5, { align: "center" });

  drawFooter(doc, { page, author: meta.author, note: "Remito interno, sin valor comercial" });
  return `remito-${data.number}.pdf`;
}

/** Los datos del remito a partir de un movimiento de stock y su material. */
export function remitoFromMovement(movement: Record<string, unknown>, item: { name: string; unit: string; sku?: string }): RemitoData {
  const kind = movement.kind === "transferencia" ? "transferencia" : "egreso";
  return {
    number: String(movement.remito || ""),
    date: String(movement.date || movement.createdAt || new Date().toISOString()),
    kind,
    fromWarehouse: warehouseLabel(String(movement.warehouse || "central")),
    destination: kind === "transferencia" ? warehouseLabel(String(movement.toWarehouse || "")) : String(movement.destinationLabel || movement.note || "Obra"),
    quoteNumber: movement.quoteNumber ? String(movement.quoteNumber) : undefined,
    items: [{ code: item.sku, name: item.name, unit: item.unit, quantity: Math.abs(Number(movement.quantity || 0)) }],
    note: kind === "transferencia" ? String(movement.note || "") : "",
    userName: String(movement.userName || ""),
  };
}

export async function downloadRemitoPdf(data: RemitoData) {
  const [{ jsPDF }, logo, session] = await Promise.all([
    import("jspdf"),
    readPdfLogo(),
    fetch("/api/auth/me").then(response => response.ok ? response.json() : null).catch(() => null),
  ]);
  const doc = new jsPDF();
  const filename = buildRemitoPdf(doc, data, { author: session?.name || data.userName || "el sistema", logo });
  doc.save(filename);
}
