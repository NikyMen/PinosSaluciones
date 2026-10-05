import type { jsPDF } from "jspdf";
import { date, money, preciseMoney, qty } from "./format";
import { amountInWords, drawFooter, drawLetterhead, INK, LINE, MUTED, NAVY, PAGE, plain, RED, readPdfLogo, type Rgb } from "./pdf-brand";
import { companyOf, type CompanyKey } from "./companies";
import { computeCascade, type CascadeParams, type OverheadLine, type QuoteItem } from "./cascada";

/**
 * Cotización en PDF: el presupuesto que se le manda al cliente. Es lo único del
 * cotizador que ve el cliente: los ítems con su memoria descriptiva, el precio
 * de cada uno y el total. El costeo (insumos, gastos, porcentajes de la
 * cascada) no sale nunca en este papel. Modelo: docs/modelo-datos/cotizacion-pdf.md.
 *
 * Los precios van con IVA incluido, igual que en la pestaña Precio del
 * cotizador. Una cotización vieja, sin ítems costeados, sale con un renglón: el
 * título y el importe cargado a mano.
 */

export type QuotePdfLine = { code?: string; name: string; detail?: string; unit: string; quantity: number; unitCents: number; totalCents: number };

export type QuotePdfData = {
  /** Qué empresa cotiza: su membrete. */
  company?: CompanyKey;
  number: string;
  version?: number;
  date: string;
  validUntil?: string;
  title: string;
  description?: string;
  client: { name: string; cuit?: string; address?: string; contactName?: string; email?: string; phone?: string };
  items: QuotePdfLine[];
  totalCents: number;
  userName?: string;
};

const { margin: MARGIN, width: WIDTH, bottom: BOTTOM } = PAGE;
const INNER = WIDTH - MARGIN * 2;

/** Escribe la cotización. Devuelve el nombre con el que conviene guardarla. */
export function buildQuotePdf(doc: jsPDF, data: QuotePdfData, meta: { author: string; logo?: string }) {
  let y = 0;
  let page = 1;
  const company = companyOf(data.company);
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
      title: "Cotización", number: `N° ${data.number}${data.version && data.version > 1 ? ` - v${data.version}` : ""}`, logo: meta.logo, company,
      lines: [`Fecha: ${date(data.date)}`, ...(data.validUntil ? [`Válida hasta: ${date(data.validUntil)}`] : [])],
    });
  }

  // Columnas: ítem y descripción a la izquierda, números a la derecha.
  const col = { code: MARGIN + 3, name: MARGIN + 17, unit: 122, qty: 141, unitPrice: 168, total: WIDTH - MARGIN - 3 };
  const nameWidth = col.unit - col.name - 4;

  function tableHead() {
    setFill([237, 241, 246]);
    doc.rect(MARGIN, y - 5, INNER, 8, "F");
    setColor(MUTED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("ÍTEM", col.code, y);
    doc.text("DESCRIPCIÓN", col.name, y);
    doc.text("UNIDAD", col.unit, y);
    doc.text("CANT.", col.qty, y, { align: "right" });
    doc.text("P. UNITARIO", col.unitPrice, y, { align: "right" });
    doc.text("IMPORTE", col.total, y, { align: "right" });
    y += 8;
  }

  function ensure(space: number, withTableHead = false) {
    if (y + space <= BOTTOM) return;
    drawFooter(doc, { page, author: meta.author, company });
    doc.addPage();
    page += 1;
    header();
    if (withTableHead) tableHead();
  }

  /** Un texto largo que puede seguir en la hoja siguiente. */
  function paragraph(text: string, x: number, width: number, lineHeight = 4.4) {
    for (const line of doc.splitTextToSize(plain(text), width) as string[]) {
      ensure(lineHeight);
      doc.text(line, x, y);
      y += lineHeight;
    }
  }

  header();

  /* ── Cliente | trabajo ───────────────────────────────────────────────────── */
  const boxTop = y;
  const boxHeight = 36;
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
      doc.text(clip(value || "-", INNER / 2 - 34), x + 22, top);
    });
  }

  block(MARGIN + 5, "CLIENTE", data.client.name || "Cliente", [
    ["CUIT", data.client.cuit || ""],
    ["Domicilio", data.client.address || ""],
    ["Contacto", [data.client.contactName, data.client.phone, data.client.email].filter(Boolean).join(" - ")],
  ]);
  block(WIDTH / 2 + 6, "TRABAJO", data.title || "Cotización", [
    ["Cotización", `${data.number}${data.version && data.version > 1 ? ` (versión ${data.version})` : ""}`],
    ["Moneda", "Pesos argentinos, IVA incluido"],
    ["Validez", data.validUntil ? `Hasta el ${date(data.validUntil)}` : "A confirmar"],
  ]);
  y = boxTop + boxHeight + 9;

  /* ── Presentación y memoria descriptiva ─────────────────────────────────── */
  setColor(INK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.4);
  paragraph("De nuestra consideración: tenemos el agrado de presentarles nuestra cotización por los trabajos que se detallan a continuación.", MARGIN, INNER);
  y += 3;
  if (data.description?.trim()) {
    ensure(14);
    setColor(RED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("DESCRIPCIÓN DE LOS TRABAJOS", MARGIN, y);
    y += 5.5;
    setColor(INK);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    for (const part of data.description.trim().split(/\n+/)) paragraph(part, MARGIN, INNER);
    y += 3;
  }
  y += 4;

  /* ── Los ítems ───────────────────────────────────────────────────────────── */
  ensure(30);
  setColor(RED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("DETALLE DE LA COTIZACIÓN", MARGIN, y);
  y += 8;
  tableHead();

  data.items.forEach((item, index) => {
    doc.setFontSize(7.2);
    const detail = item.detail?.trim() ? doc.splitTextToSize(plain(item.detail.trim()), nameWidth) as string[] : [];
    doc.setFontSize(8.2);
    const names = (doc.splitTextToSize(plain(item.name), nameWidth) as string[]).slice(0, 3);
    ensure(names.length * 4.2 + Math.min(detail.length, 3) * 3.8 + 4, true);
    const top = y;
    setColor(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    doc.text(clip(item.code || String(index + 1), col.name - col.code - 2), col.code, y);
    setColor(INK);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    doc.text(clip(item.unit || "-", col.qty - col.unit - 10), col.unit, y);
    doc.text(plain(qty(item.quantity)), col.qty, y, { align: "right" });
    doc.text(plain(preciseMoney(item.unitCents)), col.unitPrice, y, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(plain(money(item.totalCents)), col.total, y, { align: "right" });
    for (const line of names) { doc.text(line, col.name, y); y += 4.2; }
    // La memoria descriptiva del ítem, que puede ser larga: sigue en la hoja siguiente si hace falta.
    setColor(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    for (const line of detail) {
      ensure(3.8, true);
      doc.text(line, col.name, y);
      y += 3.8;
    }
    y = Math.max(y, top + 4.2) + 2.4;
    setFill(LINE);
    doc.rect(MARGIN, y - 4.4, INNER, 0.2, "F");
  });
  y += 6;

  /* ── Total y condiciones ─────────────────────────────────────────────────── */
  ensure(46);
  const totalWidth = 82;
  const totalX = WIDTH - MARGIN - totalWidth;
  setFill([248, 250, 252]);
  doc.roundedRect(totalX, y - 6, totalWidth, 17, 2, 2, "F");
  setColor(NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text("TOTAL", totalX + 5, y + 2);
  doc.text(plain(money(data.totalCents)), WIDTH - MARGIN - 5, y + 2, { align: "right" });
  setColor(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("IVA incluido", totalX + 5, y + 7);

  const noteWidth = totalX - MARGIN - 8;
  const notes = [
    "Precios en pesos argentinos con IVA incluido.",
    data.validUntil ? `Precios y condiciones válidos hasta el ${date(data.validUntil)}.` : "Precios sujetos a confirmación al momento de la aprobación.",
  ];
  setColor(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  let noteY = y;
  for (const line of notes.flatMap(note => doc.splitTextToSize(plain(note), noteWidth) as string[])) {
    doc.text(line, MARGIN, noteY);
    noteY += 4.2;
  }
  y = Math.max(y + 19, noteY + 4);

  setColor(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Son:", MARGIN, y);
  doc.setFont("helvetica", "normal");
  for (const line of (doc.splitTextToSize(plain(amountInWords(data.totalCents)), INNER - 10) as string[]).slice(0, 2)) {
    doc.text(line, MARGIN + 9, y);
    y += 4.4;
  }

  // La firma de quien cotiza y la conformidad del cliente, al pie de la última hoja.
  ensure(28);
  const signY = Math.max(y + 22, 262);
  setStroke([150, 160, 172]);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, signY, MARGIN + 70, signY);
  doc.line(WIDTH - MARGIN - 70, signY, WIDTH - MARGIN, signY);
  setColor(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  doc.text(plain(`Por ${company.legalName}`), MARGIN + 35, signY + 4.5, { align: "center" });
  doc.text("Conformidad del cliente (firma y aclaración)", WIDTH - MARGIN - 35, signY + 4.5, { align: "center" });

  drawFooter(doc, { page, author: meta.author, company });
  return `cotizacion-${data.number}${data.version && data.version > 1 ? `-v${data.version}` : ""}.pdf`;
}

type Loose = Record<string, unknown> | null | undefined;
const isoOrUndefined = (value: unknown) => value ? new Date(String(value instanceof Date ? value.toISOString() : value)).toISOString() : undefined;

/**
 * Los datos del PDF a partir de la cotización completa (con ítems) y su cliente.
 * Los precios de cada ítem salen de la misma cascada que guarda el cotizador.
 */
export function quotePdfData(quote: Record<string, unknown>, client: Loose): QuotePdfData {
  const rawItems = (Array.isArray(quote.items) ? quote.items : []) as Array<QuoteItem & { detail?: string }>;
  const priced = rawItems.length ? computeCascade({
    items: rawItems, overheads: (Array.isArray(quote.overheads) ? quote.overheads : []) as OverheadLine[],
    params: (quote.cascade || {}) as Partial<CascadeParams>,
  }) : null;
  const items: QuotePdfLine[] = priced
    ? priced.items.map((item, index) => ({ code: item.code || "", name: item.name, detail: rawItems[index]?.detail || "", unit: item.unit, quantity: item.qty, unitCents: item.unitPriceCents, totalCents: item.priceCents }))
    : [{ code: "1", name: String(quote.title || "Trabajos cotizados"), unit: "gl", quantity: 1, unitCents: Number(quote.amountCents || 0), totalCents: Number(quote.amountCents || 0) }];
  return {
    company: companyOf(quote.company).key,
    number: String(quote.number || ""),
    version: Number(quote.version || 1),
    date: isoOrUndefined(quote.createdAt) || new Date().toISOString(),
    validUntil: isoOrUndefined(quote.validUntil),
    title: String(quote.title || ""),
    description: String(quote.description || ""),
    client: {
      name: String(client?.name || "Cliente"), cuit: String(client?.cuit || ""), address: String(client?.address || ""),
      contactName: String(client?.contactName || ""), email: String(client?.email || ""),
      phone: Array.isArray(client?.phones) ? String(client.phones[0] || "") : "",
    },
    items,
    // Con ítems, el total es la suma de los renglones: así el papel cierra al peso.
    totalCents: priced ? items.reduce((total, item) => total + item.totalCents, 0) : Number(quote.amountCents || 0),
  };
}

/** Arma el PDF en el navegador y lo descarga. */
export async function downloadQuotePdf(data: QuotePdfData) {
  const [{ jsPDF }, logo, session] = await Promise.all([
    import("jspdf"),
    readPdfLogo(),
    fetch("/api/auth/me").then(response => response.ok ? response.json() : null).catch(() => null),
  ]);
  const doc = new jsPDF();
  const filename = buildQuotePdf(doc, data, { author: session?.name || data.userName || "el sistema", logo });
  doc.save(filename);
}
