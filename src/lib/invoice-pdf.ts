import type { jsPDF } from "jspdf";
import { date, dateTime, money, todayIso } from "./format";

/**
 * Factura de avance de obra, en PDF.
 *
 * Es el papel que se le da al cliente cuando se aprueba una cotización y se
 * factura un porcentaje del trabajo. El armado imita a un comprobante de ARCA
 * (la letra en un recuadro al medio, el emisor a la izquierda, la numeración a
 * la derecha, el detalle y el total) para que se lea como lo que es, pero **no
 * tiene validez fiscal**: no hay CAE ni punto de venta habilitado, y así lo
 * dice el papel en el aviso de arriba y en el pie.
 */

export type InvoicePdfData = {
  /** Número del certificado con el que queda guardado el avance. */
  number: string;
  period: string;
  percentage: number;
  amountCents: number;
  client: { name: string; cuit?: string; address?: string; email?: string };
  quote: { number: string; title: string; description?: string; amountCents: number };
  work: { code: string; name: string; startDate?: string };
};

const NAVY: [number, number, number] = [0, 48, 91];
const RED: [number, number, number] = [224, 0, 16];
const INK: [number, number, number] = [23, 34, 53];
const MUTED: [number, number, number] = [105, 115, 134];
const LINE: [number, number, number] = [223, 229, 236];

const MARGIN = 14;
const WIDTH = 210;
const INNER = WIDTH - MARGIN * 2;

/** El logo del sitio, en base64, que es como lo quiere jsPDF. Solo en el navegador. */
export async function readBrandLogo() {
  try {
    const blob = await (await fetch("/brand/pino-logo.png")).blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("logo"));
      reader.readAsDataURL(blob);
    });
  } catch { return undefined; }
}

/** Las fuentes base del PDF dibujan raro el espacio duro del `Intl` y los ·. */
function plain(text: string) {
  return text.replace(/ /g, " ").replace(/·/g, "-");
}

/** Escribe la factura de avance. Devuelve el nombre con el que conviene guardarla. */
export function buildInvoicePdf(doc: jsPDF, data: InvoicePdfData, meta: { author: string; logo?: string }) {
  const setColor = ([r, g, b]: [number, number, number]) => doc.setTextColor(r, g, b);
  const setFill = ([r, g, b]: [number, number, number]) => doc.setFillColor(r, g, b);
  const setStroke = ([r, g, b]: [number, number, number]) => doc.setDrawColor(r, g, b);

  function clip(text: string, maxWidth: number) {
    if (doc.getTextWidth(text) <= maxWidth) return text;
    let cut = text;
    while (cut.length > 3 && doc.getTextWidth(`${cut}...`) > maxWidth) cut = cut.slice(0, -1);
    return `${cut}...`;
  }

  /* ── Barra superior, la misma que el resto de los papeles de la empresa ──── */
  setFill(NAVY);
  doc.rect(0, 0, WIDTH, 30, "F");
  setFill(RED);
  doc.rect(0, 30, WIDTH, 1.6, "F");
  // El logo va sobre fondo blanco: sobre el azul de la barra se ensucia.
  const textLeft = meta.logo ? MARGIN + 22 : MARGIN;
  if (meta.logo) {
    setFill([255, 255, 255]);
    doc.roundedRect(MARGIN, 6, 18, 18, 2, 2, "F");
    try { doc.addImage(meta.logo, "PNG", MARGIN + 1.5, 7.5, 15, 15); } catch { /* si el logo no carga, se sigue sin él */ }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("PINO SOLUCIONES TECNICAS", textLeft, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Factura de avance de obra", textLeft, 20);
  doc.text(plain(`Emitido: ${dateTime(new Date())}`), WIDTH - MARGIN, 20, { align: "right" });

  /* ── Encabezado del comprobante: emisor | letra | numeración ─────────────── */
  const boxTop = 42;
  const boxHeight = 36;
  setStroke(LINE);
  doc.setLineWidth(0.4);
  doc.rect(MARGIN, boxTop, INNER, boxHeight);
  doc.line(WIDTH / 2, boxTop, WIDTH / 2, boxTop + boxHeight);

  setColor(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("PINO SOLUCIONES TECNICAS", MARGIN + 5, boxTop + 9);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  setColor(MUTED);
  doc.text("Servicios de construccion y mantenimiento", MARGIN + 5, boxTop + 15);
  doc.text("CUIT: a completar", MARGIN + 5, boxTop + 20.5);
  doc.text("Condicion frente al IVA: a completar", MARGIN + 5, boxTop + 26);
  doc.text("Documento interno - sin validez fiscal", MARGIN + 5, boxTop + 31.5);

  const rightX = WIDTH / 2 + 7;
  setColor(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("FACTURACION DE AVANCE", rightX, boxTop + 9);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  setColor(MUTED);
  doc.text(plain(`Comprobante N: ${data.number}`), rightX, boxTop + 15);
  doc.text(plain(`Fecha de emision: ${date(todayIso())}`), rightX, boxTop + 20.5);
  doc.text(plain(`Periodo: ${data.period}`), rightX, boxTop + 26);
  doc.text(plain(`Cotizacion de origen: ${data.quote.number || "-"}`), rightX, boxTop + 31.5);

  // La letra en un recuadro al medio, como en los comprobantes de ARCA. Va
  // último para que tape la línea divisoria y no al revés.
  const letterWidth = 20;
  setFill([255, 255, 255]);
  doc.rect(WIDTH / 2 - letterWidth / 2, boxTop - 6, letterWidth, 20, "FD");
  setColor(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("X", WIDTH / 2, boxTop + 5, { align: "center" });
  setColor(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5);
  doc.text("DOC. NO FISCAL", WIDTH / 2, boxTop + 11, { align: "center" });

  let y = boxTop + boxHeight + 9;

  /* ── El aviso, para que nadie lo presente como una factura de verdad ─────── */
  setFill([255, 248, 232]);
  setStroke([243, 217, 168]);
  doc.roundedRect(MARGIN, y, INNER, 13, 2, 2, "FD");
  setColor([122, 84, 16]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("DOCUMENTO SIN VALIDEZ FISCAL", MARGIN + 5, y + 5.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.text("No reemplaza a la factura electronica: no tiene CAE ni punto de venta habilitado ante ARCA.", MARGIN + 5, y + 10);
  y += 22;

  function sectionTitle(title: string, subtitle: string) {
    setColor(RED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(subtitle.toUpperCase(), MARGIN, y);
    setColor(NAVY);
    doc.setFontSize(13);
    doc.text(plain(clip(title, INNER)), MARGIN, y + 7);
    setFill(LINE);
    doc.rect(MARGIN, y + 10.5, INNER, 0.4, "F");
    y += 18;
  }

  /** Pares "etiqueta / valor" en dos columnas. */
  function pairs(rows: Array<[string, string]>) {
    rows.forEach(([label, value], index) => {
      const x = index % 2 === 0 ? MARGIN : MARGIN + INNER / 2;
      const top = y + Math.floor(index / 2) * 7;
      setColor(MUTED);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      doc.text(label.toUpperCase(), x, top);
      setColor(INK);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.6);
      doc.text(plain(clip(value || "-", INNER / 2 - 30)), x + 26, top);
    });
    y += Math.ceil(rows.length / 2) * 7 + 5;
  }

  /* ── A quién se le factura ──────────────────────────────────────────────── */
  sectionTitle(data.client.name || "Cliente", "Facturar a");
  pairs([
    ["CUIT", data.client.cuit || ""],
    ["Correo", data.client.email || ""],
    ["Domicilio", data.client.address || ""],
    ["Obra", `${data.work.code} - ${data.work.name}`],
  ]);

  /* ── El detalle: una línea, el avance que se factura ─────────────────────── */
  sectionTitle("Detalle", "Concepto facturado");
  const amountX = WIDTH - MARGIN - 3;
  setFill([237, 241, 246]);
  doc.rect(MARGIN, y - 5, INNER, 8, "F");
  setColor(MUTED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("DESCRIPCION", MARGIN + 3, y);
  doc.text("AVANCE", 132, y, { align: "right" });
  doc.text("PRESUPUESTO", 165, y, { align: "right" });
  doc.text("IMPORTE", amountX, y, { align: "right" });
  y += 10;

  setColor(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.8);
  doc.text(plain(clip(`Obra ${data.work.code} - ${data.quote.title || data.work.name}`, 100)), MARGIN + 3, y);
  doc.text(`${data.percentage}%`, 132, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.text(plain(money(data.quote.amountCents)), 165, y, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.text(plain(money(data.amountCents)), amountX, y, { align: "right" });
  y += 6;

  setColor(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.4);
  const detail = data.quote.description?.trim() || `Certificado ${data.number} - periodo ${data.period}`;
  for (const line of doc.splitTextToSize(plain(detail), INNER - 8).slice(0, 5)) {
    doc.text(line, MARGIN + 3, y);
    y += 4.6;
  }
  y += 4;
  setFill(LINE);
  doc.rect(MARGIN, y, INNER, 0.4, "F");
  y += 13;

  /* ── El total y de dónde sale ese número ─────────────────────────────────── */
  const totalWidth = 80;
  const totalX = WIDTH - MARGIN - totalWidth;
  setFill([248, 250, 252]);
  doc.roundedRect(totalX, y - 7, totalWidth, 27, 2, 2, "F");
  setColor(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Subtotal", totalX + 5, y);
  doc.text(plain(money(data.amountCents)), WIDTH - MARGIN - 5, y, { align: "right" });
  setColor(NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("TOTAL", totalX + 5, y + 12);
  doc.text(plain(money(data.amountCents)), WIDTH - MARGIN - 5, y + 12, { align: "right" });

  setColor(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  // Hasta donde empieza el recuadro del total: los codigos largos no lo pisan.
  const noteWidth = totalX - MARGIN - 6;
  doc.text(plain(clip(`Se factura el ${data.percentage}% de ${money(data.quote.amountCents)} presupuestados.`, noteWidth)), MARGIN, y);
  doc.text(plain(clip(`Cotizacion ${data.quote.number || "-"} aprobada y convertida en la obra ${data.work.code}.`, noteWidth)), MARGIN, y + 5.5);
  if (data.work.startDate) doc.text(plain(clip(`Inicio previsto de la obra: ${date(data.work.startDate)}.`, noteWidth)), MARGIN, y + 11);

  /* ── Pie ─────────────────────────────────────────────────────────────────── */
  setColor(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(plain(`Generado por ${meta.author} - Documento interno, sin validez fiscal`), MARGIN, 288);
  doc.text("Pagina 1", WIDTH - MARGIN, 288, { align: "right" });

  return `factura-avance-${data.number}.pdf`;
}
