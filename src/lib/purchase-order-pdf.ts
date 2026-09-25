import type { jsPDF } from "jspdf";
import { date, money, qty } from "./format";
import { VAT_RATE } from "./price-lists";
import { amountInWords, COMPANY, drawFooter, drawLetterhead, INK, LINE, MUTED, NAVY, PAGE, plain, RED, readPdfLogo, type Rgb } from "./pdf-brand";
import { deliveryLabel } from "./warehouses";

/**
 * Orden de compra en PDF: el papel que se le pasa al proveedor para hacer el
 * pedido. Sigue el modelo de las órdenes del sistema anterior: membrete con los
 * datos de la empresa, el proveedor y los datos de la entrega, un renglón por
 * producto, los totales con el importe en letras, a nombre de quién va la
 * factura y la firma del responsable.
 */

export type PurchaseOrderLine = {
  code?: string; name: string; presentation?: string; quantity: number;
  listPriceCents: number; discountPct: number; unitCents: number; totalCents: number;
};

export type PurchaseOrderPdfData = {
  number: string;
  requestedDate: string;
  expectedDate?: string;
  priceListDate?: string;
  /** Dónde entrega el proveedor: "central", "salon" u "obra". */
  deliverTo?: string;
  notes?: string;
  userName?: string;
  supplier: { name: string; contactName?: string; phone?: string; email?: string; address?: string };
  work?: { code?: string; name?: string; quoteNumber?: string } | null;
  items: PurchaseOrderLine[];
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
};

const { margin: MARGIN, width: WIDTH, bottom: BOTTOM } = PAGE;
const INNER = WIDTH - MARGIN * 2;

/** Escribe la orden. Devuelve el nombre con el que conviene guardarla. */
export function buildPurchaseOrderPdf(doc: jsPDF, data: PurchaseOrderPdfData, meta: { author: string; logo?: string }) {
  let y = 0;
  let page = 1;
  const setColor = ([r, g, b]: Rgb) => doc.setTextColor(r, g, b);
  const setFill = ([r, g, b]: Rgb) => doc.setFillColor(r, g, b);
  const setStroke = ([r, g, b]: Rgb) => doc.setDrawColor(r, g, b);

  function clip(text: string, maxWidth: number) {
    const clean = plain(text);
    if (doc.getTextWidth(clean) <= maxWidth) return clean;
    let cut = clean;
    while (cut.length > 3 && doc.getTextWidth(`${cut}...`) > maxWidth) cut = cut.slice(0, -1);
    return `${cut}...`;
  }

  function header() {
    y = drawLetterhead(doc, {
      title: "Orden de compra", number: `N° ${data.number}`, logo: meta.logo,
      lines: [`Fecha de emisión: ${date(data.requestedDate)}`, `Entrega: ${data.expectedDate ? date(data.expectedDate) : "a coordinar"}`],
    });
  }

  // Columnas de la tabla: código y producto a la izquierda, números a la derecha.
  const col = { code: MARGIN + 3, product: MARGIN + 27, qty: 114, list: 137, discount: 151, unit: 170, total: WIDTH - MARGIN - 3 };

  function tableHead() {
    setFill([237, 241, 246]);
    doc.rect(MARGIN, y - 5, INNER, 8, "F");
    setColor(MUTED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("CÓDIGO", col.code, y);
    doc.text("DESCRIPCIÓN", col.product, y);
    doc.text("CANT.", col.qty, y, { align: "right" });
    doc.text("P. LISTA", col.list, y, { align: "right" });
    doc.text("BONIF.", col.discount, y, { align: "right" });
    doc.text("P. UNIT.", col.unit, y, { align: "right" });
    doc.text("IMPORTE", col.total, y, { align: "right" });
    y += 8;
  }

  function ensure(space: number, withTableHead = false) {
    if (y + space <= BOTTOM) return;
    drawFooter(doc, { page, author: meta.author });
    doc.addPage();
    page += 1;
    header();
    if (withTableHead) tableHead();
  }

  header();

  /* ── Proveedor | entrega ─────────────────────────────────────────────────── */
  const boxTop = y;
  const boxHeight = 40;
  setStroke(LINE);
  doc.setLineWidth(0.4);
  doc.roundedRect(MARGIN, boxTop, INNER, boxHeight, 2, 2);
  doc.line(WIDTH / 2, boxTop, WIDTH / 2, boxTop + boxHeight);

  function block(x: number, title: string, heading: string, rows: Array<[string, string]>) {
    setColor(RED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(title, x, boxTop + 7);
    setColor(NAVY);
    doc.setFontSize(10.5);
    doc.text(clip(heading, INNER / 2 - 12), x, boxTop + 13);
    rows.forEach(([label, value], index) => {
      const top = boxTop + 19.5 + index * 4.9;
      setColor(MUTED);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.text(plain(label.toUpperCase()), x, top);
      setColor(INK);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.8);
      doc.text(clip(value || "-", INNER / 2 - 36), x + 25, top);
    });
  }

  block(MARGIN + 5, "PROVEEDOR", data.supplier.name, [
    ["Contacto", data.supplier.contactName || ""],
    ["Teléfono", data.supplier.phone || ""],
    ["Correo", data.supplier.email || ""],
    ["Dirección", data.supplier.address || ""],
  ]);
  const deliverTo = data.deliverTo === "obra" && data.work?.code ? `En la obra ${data.work.code}` : deliveryLabel(data.deliverTo);
  block(WIDTH / 2 + 6, "ENTREGA", deliverTo, [
    ["Obra", data.work?.code ? `${data.work.code} - ${data.work.name || ""}` : "Sin obra asignada"],
    ["Cotización", data.work?.quoteNumber || "-"],
    ["Comprador", data.userName || meta.author],
    ["Lista de precios", data.priceListDate ? `Vigente desde ${date(data.priceListDate)}` : "-"],
  ]);
  y = boxTop + boxHeight + 7;

  // Quién retira el material: se completa a mano, como en las órdenes de antes.
  setColor(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  doc.text("Responsable de retiro:", MARGIN, y);
  doc.text("DNI:", 132, y);
  setStroke([190, 199, 210]);
  doc.setLineWidth(0.2);
  doc.line(MARGIN + 31, y + 0.8, 126, y + 0.8);
  doc.line(139, y + 0.8, WIDTH - MARGIN, y + 0.8);
  y += 11;

  /* ── Los productos ───────────────────────────────────────────────────────── */
  setColor(RED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("DETALLE DEL PEDIDO", MARGIN, y);
  setColor(NAVY);
  doc.setFontSize(11.5);
  doc.text(`${data.items.length} ${data.items.length === 1 ? "producto" : "productos"}`, MARGIN, y + 6);
  y += 14;
  tableHead();

  data.items.forEach((item, index) => {
    const hasPresentation = Boolean(item.presentation);
    const height = hasPresentation ? 10.5 : 7.4;
    ensure(height + 2, true);
    if (index % 2 === 1) {
      setFill([250, 251, 253]);
      doc.rect(MARGIN, y - 4.6, INNER, height, "F");
    }
    setColor(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    doc.text(clip(item.code || "-", col.product - col.code - 3), col.code, y);
    setColor(INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.2);
    doc.text(clip(item.name, col.qty - col.product - 16), col.product, y);
    doc.setFont("helvetica", "normal");
    doc.text(plain(qty(item.quantity)), col.qty, y, { align: "right" });
    doc.text(plain(money(item.listPriceCents)), col.list, y, { align: "right" });
    doc.text(item.discountPct ? plain(`${qty(item.discountPct)}%`) : "-", col.discount, y, { align: "right" });
    doc.text(plain(money(item.unitCents)), col.unit, y, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(plain(money(item.totalCents)), col.total, y, { align: "right" });
    if (hasPresentation) {
      setColor(MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(clip(item.presentation!, col.qty - col.product - 16), col.product, y + 4);
    }
    y += height;
  });
  setFill(LINE);
  doc.rect(MARGIN, y - 2, INNER, 0.4, "F");
  y += 8;

  /* ── Condiciones | totales ───────────────────────────────────────────────── */
  ensure(62);
  const totalWidth = 82;
  const totalX = WIDTH - MARGIN - totalWidth;
  setFill([248, 250, 252]);
  doc.roundedRect(totalX, y - 6, totalWidth, 30, 2, 2, "F");
  setColor(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.text("Subtotal (sin IVA)", totalX + 5, y);
  doc.text(plain(money(data.subtotalCents)), WIDTH - MARGIN - 5, y, { align: "right" });
  doc.text(`IVA ${Math.round(VAT_RATE * 100)}%`, totalX + 5, y + 6.5);
  doc.text(plain(money(data.vatCents)), WIDTH - MARGIN - 5, y + 6.5, { align: "right" });
  setColor(NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text("TOTAL", totalX + 5, y + 17);
  doc.text(plain(money(data.totalCents)), WIDTH - MARGIN - 5, y + 17, { align: "right" });

  // A la izquierda: la condición de devolución y las observaciones.
  const noteWidth = totalX - MARGIN - 8;
  const notes = [
    "Los productos que no se entreguen en condiciones óptimas podrán ser devueltos y repuestos por el proveedor sin que esto genere mayores costos.",
    "Precios sin IVA según la lista vigente del proveedor, con la bonificación acordada.",
    ...(data.notes?.trim() ? [`Observaciones: ${data.notes.trim()}`] : []),
  ];
  setColor(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.4);
  let noteY = y;
  for (const line of notes.flatMap(note => doc.splitTextToSize(plain(note), noteWidth) as string[]).slice(0, 8)) {
    doc.text(line, MARGIN, noteY);
    noteY += 4.2;
  }
  y = Math.max(y + 32, noteY + 4);

  // Son pesos, y a nombre de quién va la factura.
  setColor(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Son:", MARGIN, y);
  doc.setFont("helvetica", "normal");
  for (const line of (doc.splitTextToSize(plain(amountInWords(data.totalCents)), INNER - 10) as string[]).slice(0, 2)) {
    doc.text(line, MARGIN + 9, y);
    y += 4.4;
  }
  y += 3;
  setColor(NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(plain(`Enviar factura a favor de: ${COMPANY.legalName.toUpperCase()} (CUIT ${COMPANY.cuit})`), MARGIN, y);

  // La firma, siempre al pie de la última hoja.
  ensure(28);
  const signY = Math.max(y + 22, 262);
  setStroke([150, 160, 172]);
  doc.setLineWidth(0.3);
  doc.line(WIDTH - MARGIN - 70, signY, WIDTH - MARGIN, signY);
  setColor(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  doc.text("Firma del responsable", WIDTH - MARGIN - 35, signY + 4.5, { align: "center" });

  drawFooter(doc, { page, author: meta.author });
  return `orden-de-compra-${data.number}.pdf`;
}

type Loose = Record<string, unknown> | null | undefined;
const isoOrUndefined = (value: unknown) => value ? new Date(String(value instanceof Date ? value.toISOString() : value)).toISOString() : undefined;

/**
 * Los datos del PDF a partir de la orden guardada, su proveedor y su obra. Sirve
 * igual en el servidor (al cerrar la orden) que en el listado de órdenes (para
 * volver a bajarla): las fechas pueden venir como Date o como texto.
 */
export function purchaseOrderPdfData(purchase: Record<string, unknown>, supplier: Loose, work: Loose, quoteNumber?: string): PurchaseOrderPdfData {
  const items = (Array.isArray(purchase.items) ? purchase.items : []) as PurchaseOrderLine[];
  const subtotalCents = Number(purchase.subtotalCents ?? items.reduce((total, item) => total + Number(item.totalCents || 0), 0));
  return {
    number: String(purchase.number || ""),
    requestedDate: isoOrUndefined(purchase.requestedDate) || new Date().toISOString(),
    expectedDate: isoOrUndefined(purchase.expectedDate),
    priceListDate: isoOrUndefined(purchase.priceListDate),
    deliverTo: String(purchase.deliverTo || "central"),
    notes: String(purchase.notes || ""),
    userName: String(purchase.userName || ""),
    supplier: {
      name: String(supplier?.name || "Proveedor"), contactName: String(supplier?.contactName || ""),
      phone: String(supplier?.phone || ""), email: String(supplier?.email || ""), address: String(supplier?.address || ""),
    },
    work: work ? { code: String(work.code || ""), name: String(work.name || ""), quoteNumber: quoteNumber || String(purchase.quoteNumber || "") } : null,
    items: items.map(item => ({
      code: item.code || "", name: item.name, presentation: item.presentation || "", quantity: Number(item.quantity || 0),
      listPriceCents: Number(item.listPriceCents || 0), discountPct: Number(item.discountPct || 0), unitCents: Number(item.unitCents || 0), totalCents: Number(item.totalCents || 0),
    })),
    subtotalCents,
    vatCents: Number(purchase.vatCents ?? Math.round(subtotalCents * VAT_RATE)),
    totalCents: Number(purchase.amountCents || 0),
  };
}

/** Arma el PDF en el navegador y lo descarga. */
export async function downloadPurchaseOrderPdf(data: PurchaseOrderPdfData) {
  const [{ jsPDF }, logo, session] = await Promise.all([
    import("jspdf"),
    readPdfLogo(),
    fetch("/api/auth/me").then(response => response.ok ? response.json() : null).catch(() => null),
  ]);
  const doc = new jsPDF();
  const filename = buildPurchaseOrderPdf(doc, data, { author: session?.name || data.userName || "el sistema", logo });
  doc.save(filename);
}
