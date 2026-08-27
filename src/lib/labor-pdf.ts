import type { jsPDF } from "jspdf";
import { date, dateTime, money } from "./format";

/**
 * Liquidación de mano de obra de una obra, en PDF.
 *
 * Es el papel que se lleva a pagos: quién trabajó, cuántas jornadas y horas, a
 * qué valor y cuánto cobra cada uno, con el detalle día por día atrás. Mismo
 * armado que el reporte de gestión (`report-pdf`), con el logo arriba.
 */

export type LaborRow = {
  workerId: string; name: string; dni: string; category: string;
  mode: string; days: number; hours: number; rateCents: number; totalCents: number; manual: boolean;
};

export type LaborDetail = { person: string; date: string; quantity: string; rateCents: number; costCents: number; note: string; manual: boolean };

export type LaborPdfData = {
  work: { code: string; name: string };
  from: string; to: string;
  rows: LaborRow[];
  detail: LaborDetail[];
  totals: { days: number; hours: number; cents: number };
};

const NAVY: [number, number, number] = [0, 48, 91];
const RED: [number, number, number] = [224, 0, 16];
const INK: [number, number, number] = [23, 34, 53];
const MUTED: [number, number, number] = [105, 115, 134];
const LINE: [number, number, number] = [223, 229, 236];

const MARGIN = 14;
const WIDTH = 210;
const BOTTOM = 276;

/** Las fuentes base del PDF dibujan raro el espacio duro del `Intl` y los ·. */
function plain(text: string) {
  return text.replace(/ /g, " ").replace(/·/g, "-");
}

/** Cantidades con coma decimal: 1,5 jornadas. */
function qty(value: number) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(Math.round(value * 100) / 100);
}

/** Escribe la liquidación. Devuelve el nombre con el que conviene guardarla. */
export function buildLaborPdf(doc: jsPDF, data: LaborPdfData, meta: { author: string; logo?: string }) {
  let y = 0;
  let page = 1;

  const setColor = ([r, g, b]: [number, number, number]) => doc.setTextColor(r, g, b);
  const setFill = ([r, g, b]: [number, number, number]) => doc.setFillColor(r, g, b);

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
      try { doc.addImage(meta.logo, "PNG", MARGIN + 1.5, 7.5, 15, 15); } catch { /* si el logo no carga, se sigue sin él */ }
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("PINO SOLUCIONES TECNICAS", textLeft, 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Liquidacion de mano de obra", textLeft, 20);
    doc.text(plain(`Periodo: ${date(data.from)} al ${date(data.to)}`), WIDTH - MARGIN, 13, { align: "right" });
    doc.text(plain(`Emitido: ${dateTime(new Date())}`), WIDTH - MARGIN, 20, { align: "right" });
    y = 42;
  }

  function footer() {
    setColor(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(plain(`Generado por ${meta.author} - Documento interno, sin validez fiscal`), MARGIN, 288);
    doc.text(`Pagina ${page}`, WIDTH - MARGIN, 288, { align: "right" });
  }

  function ensure(space: number) {
    if (y + space <= BOTTOM) return;
    footer();
    doc.addPage();
    page += 1;
    header();
  }

  function sectionTitle(title: string, subtitle: string) {
    ensure(20);
    setColor(RED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(subtitle.toUpperCase(), MARGIN, y);
    setColor(NAVY);
    doc.setFontSize(13);
    doc.text(plain(title), MARGIN, y + 7);
    setFill(LINE);
    doc.rect(MARGIN, y + 10.5, WIDTH - MARGIN * 2, 0.4, "F");
    y += 18;
  }

  function tableHead(columns: Array<{ label: string; x: number; align?: "left" | "right" }>) {
    setFill([237, 241, 246]);
    doc.rect(MARGIN, y - 5, WIDTH - MARGIN * 2, 8, "F");
    setColor(MUTED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    for (const column of columns) doc.text(column.label.toUpperCase(), column.x, y, { align: column.align || "left" });
    y += 9;
  }

  function row(cells: Array<{ text: string; x: number; align?: "left" | "right"; bold?: boolean; color?: [number, number, number] }>, striped: boolean) {
    if (striped) {
      setFill([250, 251, 253]);
      doc.rect(MARGIN, y - 4.6, WIDTH - MARGIN * 2, 7.4, "F");
    }
    doc.setFontSize(8.6);
    for (const cell of cells) {
      doc.setFont("helvetica", cell.bold ? "bold" : "normal");
      setColor(cell.color || INK);
      doc.text(plain(cell.text), cell.x, y, { align: cell.align || "left" });
    }
    y += 7.4;
  }

  function clip(text: string, maxWidth: number) {
    if (doc.getTextWidth(text) <= maxWidth) return text;
    let cut = text;
    while (cut.length > 3 && doc.getTextWidth(`${cut}...`) > maxWidth) cut = cut.slice(0, -1);
    return `${cut}...`;
  }

  header();

  /* ── De qué obra y de qué período estamos hablando ───────────────────────── */
  sectionTitle(`${data.work.code} - ${data.work.name}`, "Obra");
  const cards = [
    { label: "Trabajadores", value: String(data.rows.length) },
    { label: "Jornadas", value: qty(data.totals.days) },
    { label: "Horas", value: `${qty(data.totals.hours)} h` },
    { label: "Total a pagar", value: money(data.totals.cents), tone: NAVY },
  ];
  const cardWidth = (WIDTH - MARGIN * 2 - 9) / 4;
  cards.forEach((card, index) => {
    const x = MARGIN + index * (cardWidth + 3);
    setFill([248, 250, 252]);
    doc.roundedRect(x, y - 4, cardWidth, 20, 2, 2, "F");
    setColor(MUTED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.text(card.label.toUpperCase(), x + 4, y + 2);
    setColor(card.tone || INK);
    doc.setFontSize(11);
    doc.text(plain(card.value), x + 4, y + 11);
  });
  y += 28;

  /* ── Lo que cobra cada uno ───────────────────────────────────────────────── */
  sectionTitle("A pagar por persona", "Liquidacion del periodo");
  const columns = [
    { label: "Apellido y nombre", x: MARGIN },
    { label: "DNI", x: 66 },
    { label: "Categoria", x: 90 },
    { label: "Jornadas", x: 128, align: "right" as const },
    { label: "Horas", x: 148, align: "right" as const },
    { label: "A pagar", x: WIDTH - MARGIN, align: "right" as const },
  ];
  tableHead(columns);
  if (!data.rows.length) {
    row([{ text: "No hay horas cargadas en el periodo.", x: MARGIN, color: MUTED }], false);
  } else {
    data.rows.forEach((item, index) => {
      ensure(10);
      row([
        { text: clip(item.name, 48), x: MARGIN, bold: true },
        { text: item.dni || "-", x: 66 },
        { text: clip(item.category || "-", 34), x: 90 },
        { text: qty(item.days), x: 128, align: "right" },
        { text: `${qty(item.hours)} h`, x: 148, align: "right" },
        { text: money(item.totalCents), x: WIDTH - MARGIN, align: "right", bold: true },
      ], index % 2 === 1);
    });
    ensure(12);
    setFill(LINE);
    doc.rect(MARGIN, y - 5, WIDTH - MARGIN * 2, 0.4, "F");
    y += 3;
    row([
      { text: "TOTAL", x: MARGIN, bold: true },
      { text: qty(data.totals.days), x: 128, align: "right", bold: true },
      { text: `${qty(data.totals.hours)} h`, x: 148, align: "right", bold: true },
      { text: money(data.totals.cents), x: WIDTH - MARGIN, align: "right", bold: true, color: NAVY },
    ], false);
  }
  y += 8;

  /* ── El respaldo: parte por parte ────────────────────────────────────────── */
  sectionTitle("Detalle de los partes diarios", "Respaldo");
  const detailColumns = [
    { label: "Fecha", x: MARGIN },
    { label: "Trabajador", x: 38 },
    { label: "Trabajo", x: 88 },
    { label: "Valor", x: 132 },
    { label: "Tarea", x: 152 },
    { label: "Importe", x: WIDTH - MARGIN, align: "right" as const },
  ];
  tableHead(detailColumns);
  if (!data.detail.length) {
    row([{ text: "Sin partes cargados en el periodo.", x: MARGIN, color: MUTED }], false);
  } else {
    data.detail.forEach((item, index) => {
      ensure(10);
      row([
        { text: date(item.date), x: MARGIN },
        { text: clip(item.person, 46), x: 38, bold: true },
        { text: item.quantity, x: 88 },
        { text: money(item.rateCents), x: 132 },
        { text: clip(item.note || "-", 30), x: 152 },
        { text: `${money(item.costCents)}${item.manual ? " *" : ""}`, x: WIDTH - MARGIN, align: "right" },
      ], index % 2 === 1);
    });
    if (data.detail.some(item => item.manual)) {
      ensure(10);
      row([{ text: "* Importe cargado a mano, distinto del calculado.", x: MARGIN, color: MUTED }], false);
    }
  }

  footer();
  return `liquidacion-${data.work.code}-${data.from}-a-${data.to}.pdf`;
}
