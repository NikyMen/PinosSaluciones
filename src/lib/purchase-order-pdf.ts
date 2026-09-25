import type { jsPDF } from "jspdf";
import { date, dateTime, money, qty } from "./format";
import { VAT_RATE } from "./price-lists";

/**
 * Orden de compra en PDF: el papel que se le pasa al proveedor para hacer el
 * pedido. Mismo armado que el resto de los papeles de la empresa (barra azul
 * con el logo y la línea roja), con el proveedor a la izquierda, los datos del
 * pedido a la derecha, un renglón por producto y el total con IVA.
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
  notes?: string;
  userName?: string;
  supplier: { name: string; contactName?: string; phone?: string; email?: string; address?: string };
  work?: { code?: string; name?: string } | null;
  items: PurchaseOrderLine[];
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
};

const NAVY: [number, number, number] = [0, 48, 91];
const RED: [number, number, number] = [224, 0, 16];
const INK: [number, number, number] = [23, 34, 53];
const MUTED: [number, number, number] = [105, 115, 134];
const LINE: [number, number, number] = [223, 229, 236];

const MARGIN = 14;
const WIDTH = 210;
const INNER = WIDTH - MARGIN * 2;
const BOTTOM = 272;

/** Las fuentes base del PDF dibujan raro el espacio duro del `Intl` y los ·. */
function plain(text: string) {
  return text.replace(/[  ]/g, " ").replace(/·/g, "-").replace(/²/g, "2").replace(/³/g, "3");
}

/** Escribe la orden. Devuelve el nombre con el que conviene guardarla. */
export function buildPurchaseOrderPdf(doc: jsPDF, data: PurchaseOrderPdfData, meta: { author: string; logo?: string }) {
  let y = 0;
  let page = 1;
  const setColor = ([r, g, b]: [number, number, number]) => doc.setTextColor(r, g, b);
  const setFill = ([r, g, b]: [number, number, number]) => doc.setFillColor(r, g, b);
  const setStroke = ([r, g, b]: [number, number, number]) => doc.setDrawColor(r, g, b);

  function clip(text: string, maxWidth: number) {
    const clean = plain(text);
    if (doc.getTextWidth(clean) <= maxWidth) return clean;
    let cut = clean;
    while (cut.length > 3 && doc.getTextWidth(`${cut}...`) > maxWidth) cut = cut.slice(0, -1);
    return `${cut}...`;
  }

  function header() {
    setFill(NAVY);
    doc.rect(0, 0, WIDTH, 30, "F");
    setFill(RED);
    doc.rect(0, 30, WIDTH, 1.6, "F");
    // El logo va sobre fondo blanco: sobre el azul de la barra se ensucia.
    const textLeft = meta.logo ? MARGIN + 22 : MARGIN;
    if (meta.logo) {
      setFill([255, 255, 255]);
      doc.roundedRect(MARGIN, 6, 18, 18, 2, 2, "F");
      // Comprimido: sin eso el logo solo pesa más de 2 MB y el PDF no pasa bien por WhatsApp.
      try { doc.addImage(meta.logo, "PNG", MARGIN + 1.5, 7.5, 15, 15, "pino-logo", "FAST"); } catch { /* si el logo no carga, se sigue sin él */ }
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("PINO SOLUCIONES TECNICAS", textLeft, 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Orden de compra", textLeft, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(plain(data.number), WIDTH - MARGIN, 14, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(plain(`Fecha: ${date(data.requestedDate)}`), WIDTH - MARGIN, 21, { align: "right" });
    y = 42;
  }

  function footer() {
    setColor(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(plain(`Generado por ${meta.author} el ${dateTime(new Date())}`), MARGIN, 288);
    doc.text(`Pagina ${page}`, WIDTH - MARGIN, 288, { align: "right" });
  }

  // Columnas de la tabla: código y producto a la izquierda, números a la derecha.
  const col = { code: MARGIN + 3, product: MARGIN + 27, qty: 114, list: 137, discount: 151, unit: 170, total: WIDTH - MARGIN - 3 };

  function tableHead() {
    setFill([237, 241, 246]);
    doc.rect(MARGIN, y - 5, INNER, 8, "F");
    setColor(MUTED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("CODIGO", col.code, y);
    doc.text("PRODUCTO", col.product, y);
    doc.text("CANT.", col.qty, y, { align: "right" });
    doc.text("P. LISTA", col.list, y, { align: "right" });
    doc.text("BONIF.", col.discount, y, { align: "right" });
    doc.text("P. UNIT.", col.unit, y, { align: "right" });
    doc.text("SUBTOTAL", col.total, y, { align: "right" });
    y += 8;
  }

  function ensure(space: number, withTableHead = false) {
    if (y + space <= BOTTOM) return;
    footer();
    doc.addPage();
    page += 1;
    header();
    if (withTableHead) tableHead();
  }

  header();

  /* ── Proveedor | datos del pedido ────────────────────────────────────────── */
  const boxTop = y;
  const boxHeight = 38;
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
    doc.setFontSize(11);
    doc.text(clip(heading, INNER / 2 - 12), x, boxTop + 13.5);
    rows.forEach(([label, value], index) => {
      const top = boxTop + 20 + index * 5;
      setColor(MUTED);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.6);
      doc.text(label.toUpperCase(), x, top);
      setColor(INK);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(clip(value || "-", INNER / 2 - 36), x + 24, top);
    });
  }

  block(MARGIN + 5, "PROVEEDOR", data.supplier.name, [
    ["Contacto", data.supplier.contactName || ""],
    ["Telefono", data.supplier.phone || ""],
    ["Correo", data.supplier.email || ""],
    ["Direccion", data.supplier.address || ""],
  ]);
  block(WIDTH / 2 + 6, "DATOS DEL PEDIDO", data.work?.code ? `Obra ${data.work.code}` : "Para deposito", [
    ["Obra", data.work?.code ? `${data.work.code} - ${data.work.name || ""}` : "Sin obra asignada"],
    ["Entrega", data.expectedDate ? date(data.expectedDate) : "A coordinar"],
    ["Pedido por", data.userName || meta.author],
    ["Lista", data.priceListDate ? `Vigente desde ${date(data.priceListDate)}` : "-"],
  ]);
  y = boxTop + boxHeight + 12;

  /* ── Los productos ───────────────────────────────────────────────────────── */
  setColor(RED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("DETALLE DEL PEDIDO", MARGIN, y);
  setColor(NAVY);
  doc.setFontSize(12);
  doc.text(`${data.items.length} ${data.items.length === 1 ? "producto" : "productos"}`, MARGIN, y + 6.5);
  y += 15;
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

  /* ── Totales ─────────────────────────────────────────────────────────────── */
  ensure(36);
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

  // A la izquierda del total: de dónde salen los precios y las observaciones.
  const noteWidth = totalX - MARGIN - 8;
  setColor(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  const notes = [
    "Precios sin IVA segun la lista vigente del proveedor, con la bonificacion acordada.",
    ...(data.notes?.trim() ? [`Observaciones: ${data.notes.trim()}`] : []),
  ];
  let noteY = y;
  for (const line of notes.flatMap(note => doc.splitTextToSize(plain(note), noteWidth) as string[]).slice(0, 7)) {
    doc.text(line, MARGIN, noteY);
    noteY += 4.4;
  }

  footer();
  return `orden-de-compra-${data.number}.pdf`;
}

type Loose = Record<string, unknown> | null | undefined;
const isoOrUndefined = (value: unknown) => value ? new Date(String(value instanceof Date ? value.toISOString() : value)).toISOString() : undefined;

/**
 * Los datos del PDF a partir de la orden guardada, su proveedor y su obra. Sirve
 * igual en el servidor (al cerrar la orden) que en el listado de órdenes (para
 * volver a bajarla): las fechas pueden venir como Date o como texto.
 */
export function purchaseOrderPdfData(purchase: Record<string, unknown>, supplier: Loose, work: Loose): PurchaseOrderPdfData {
  const items = (Array.isArray(purchase.items) ? purchase.items : []) as PurchaseOrderLine[];
  const subtotalCents = Number(purchase.subtotalCents ?? items.reduce((total, item) => total + Number(item.totalCents || 0), 0));
  return {
    number: String(purchase.number || ""),
    requestedDate: isoOrUndefined(purchase.requestedDate) || new Date().toISOString(),
    expectedDate: isoOrUndefined(purchase.expectedDate),
    priceListDate: isoOrUndefined(purchase.priceListDate),
    notes: String(purchase.notes || ""),
    userName: String(purchase.userName || ""),
    supplier: {
      name: String(supplier?.name || "Proveedor"), contactName: String(supplier?.contactName || ""),
      phone: String(supplier?.phone || ""), email: String(supplier?.email || ""), address: String(supplier?.address || ""),
    },
    work: work ? { code: String(work.code || ""), name: String(work.name || "") } : null,
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
  const [{ jsPDF }, { readBrandLogo }, session] = await Promise.all([
    import("jspdf"),
    import("./invoice-pdf"),
    fetch("/api/auth/me").then(response => response.ok ? response.json() : null).catch(() => null),
  ]);
  const doc = new jsPDF();
  const filename = buildPurchaseOrderPdf(doc, data, { author: session?.name || data.userName || "el sistema", logo: await readBrandLogo() });
  doc.save(filename);
}
