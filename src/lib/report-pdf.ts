import type { jsPDF } from "jspdf";
import { date, dateTime, money } from "./format";

export type ReportData = {
  cashflow: Array<{ period: string; incomeCents: number; outcomeCents: number }>;
  profitability: Array<{ id: string; name: string; budgetCents: number; revenueCents: number; costCents: number; marginCents: number }>;
};

const NAVY: [number, number, number] = [0, 48, 91];
const RED: [number, number, number] = [224, 0, 16];
const INK: [number, number, number] = [23, 34, 53];
const MUTED: [number, number, number] = [105, 115, 134];
const LINE: [number, number, number] = [223, 229, 236];
const GREEN: [number, number, number] = [21, 101, 74];

/**
 * `Intl` separa el signo con un espacio duro y usamos algún · en los títulos.
 * Las fuentes base del PDF los dibujan raro, así que se pasan a caracteres simples.
 */
function plain(text: string) {
  return text.replace(/ /g, " ").replace(/·/g, "-");
}

const MARGIN = 14;
const WIDTH = 210;
const BOTTOM = 276;

/** Escribe el PDF de gestión. Devuelve el nombre con el que conviene guardarlo. */
export function buildReportPdf(doc: jsPDF, data: ReportData, period: { from: string; to: string; author: string }) {
  let y = 0;
  let page = 1;

  const setColor = ([r, g, b]: [number, number, number]) => doc.setTextColor(r, g, b);
  const setFill = ([r, g, b]: [number, number, number]) => doc.setFillColor(r, g, b);

  function header() {
    setFill(NAVY);
    doc.rect(0, 0, WIDTH, 30, "F");
    setFill(RED);
    doc.rect(0, 30, WIDTH, 1.6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("PINO SOLUCIONES TECNICAS", MARGIN, 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Reporte de gestion", MARGIN, 20);
    doc.text(plain(`Periodo: ${date(period.from)} al ${date(period.to)}`), WIDTH - MARGIN, 13, { align: "right" });
    doc.text(plain(`Emitido: ${dateTime(new Date())}`), WIDTH - MARGIN, 20, { align: "right" });
    y = 42;
  }

  function footer() {
    setColor(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(plain(`Generado por ${period.author} - Documento interno, sin validez fiscal`), MARGIN, 288);
    doc.text(`Pagina ${page}`, WIDTH - MARGIN, 288, { align: "right" });
  }

  /** Salta de hoja si lo que viene no entra, para no cortar una fila al medio. */
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
    doc.text(title, MARGIN, y + 7);
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

  /** Recorta un texto largo para que no pise la columna siguiente. */
  function clip(text: string, maxWidth: number) {
    if (doc.getTextWidth(text) <= maxWidth) return text;
    let cut = text;
    while (cut.length > 3 && doc.getTextWidth(`${cut}...`) > maxWidth) cut = cut.slice(0, -1);
    return `${cut}...`;
  }

  header();

  /* ── Resumen ejecutivo: los números que se miran primero ─────────────────── */
  const income = data.cashflow.reduce((total, item) => total + item.incomeCents, 0);
  const outcome = data.cashflow.reduce((total, item) => total + item.outcomeCents, 0);
  const revenue = data.profitability.reduce((total, item) => total + item.revenueCents, 0);
  const costs = data.profitability.reduce((total, item) => total + item.costCents, 0);
  const margin = revenue - costs;
  const marginPercent = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null;

  sectionTitle("Resumen del periodo", "Sintesis");
  const cards = [
    { label: "Cobrado", value: money(income) },
    { label: "Pagado", value: money(outcome) },
    { label: "Flujo neto", value: money(income - outcome), tone: income - outcome >= 0 ? GREEN : RED },
    { label: "Margen de obras", value: marginPercent === null ? "s/d" : `${marginPercent}%`, tone: margin >= 0 ? GREEN : RED },
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
    setColor(card.tone || NAVY);
    doc.setFontSize(11);
    doc.text(plain(card.value), x + 4, y + 11);
  });
  y += 28;

  /* ── Flujo de caja mes a mes ─────────────────────────────────────────────── */
  sectionTitle("Flujo de caja percibido", "Cobranzas y pagos");
  const flowColumns = [
    { label: "Periodo", x: MARGIN },
    { label: "Ingresos", x: 92, align: "right" as const },
    { label: "Egresos", x: 132, align: "right" as const },
    { label: "Neto", x: WIDTH - MARGIN, align: "right" as const },
  ];
  tableHead(flowColumns);
  if (!data.cashflow.length) {
    row([{ text: "Sin movimientos en el periodo.", x: MARGIN, color: MUTED }], false);
  } else {
    data.cashflow.forEach((item, index) => {
      ensure(10);
      const net = item.incomeCents - item.outcomeCents;
      row([
        { text: item.period, x: MARGIN, bold: true },
        { text: money(item.incomeCents), x: 92, align: "right" },
        { text: money(item.outcomeCents), x: 132, align: "right" },
        { text: money(net), x: WIDTH - MARGIN, align: "right", bold: true, color: net >= 0 ? GREEN : RED },
      ], index % 2 === 1);
    });
    ensure(10);
    setFill(LINE);
    doc.rect(MARGIN, y - 5, WIDTH - MARGIN * 2, 0.4, "F");
    y += 3;
    row([
      { text: "TOTAL", x: MARGIN, bold: true },
      { text: money(income), x: 92, align: "right", bold: true },
      { text: money(outcome), x: 132, align: "right", bold: true },
      { text: money(income - outcome), x: WIDTH - MARGIN, align: "right", bold: true, color: income - outcome >= 0 ? GREEN : RED },
    ], false);
  }
  y += 8;

  /* ── Rentabilidad obra por obra ──────────────────────────────────────────── */
  sectionTitle("Rentabilidad por obra", "Ingresos devengados menos costos asignados");
  const workColumns = [
    { label: "Obra", x: MARGIN },
    { label: "Presupuesto", x: 92, align: "right" as const },
    { label: "Facturado", x: 122, align: "right" as const },
    { label: "Costos", x: 152, align: "right" as const },
    { label: "Margen", x: WIDTH - MARGIN, align: "right" as const },
  ];
  tableHead(workColumns);
  if (!data.profitability.length) {
    row([{ text: "Todavia no hay obras con facturacion ni costos asignados.", x: MARGIN, color: MUTED }], false);
  } else {
    data.profitability.forEach((item, index) => {
      ensure(10);
      const percent = item.revenueCents > 0 ? ` (${Math.round((item.marginCents / item.revenueCents) * 100)}%)` : "";
      row([
        { text: clip(item.name, 72), x: MARGIN, bold: true },
        { text: money(item.budgetCents), x: 92, align: "right" },
        { text: money(item.revenueCents), x: 122, align: "right" },
        { text: money(item.costCents), x: 152, align: "right" },
        { text: money(item.marginCents) + percent, x: WIDTH - MARGIN, align: "right", bold: true, color: item.marginCents >= 0 ? GREEN : RED },
      ], index % 2 === 1);
    });
    ensure(12);
    setFill(LINE);
    doc.rect(MARGIN, y - 5, WIDTH - MARGIN * 2, 0.4, "F");
    y += 3;
    row([
      { text: `TOTAL - ${data.profitability.length} obras`, x: MARGIN, bold: true },
      { text: "", x: 92, align: "right" },
      { text: money(revenue), x: 122, align: "right", bold: true },
      { text: money(costs), x: 152, align: "right", bold: true },
      { text: money(margin), x: WIDTH - MARGIN, align: "right", bold: true, color: margin >= 0 ? GREEN : RED },
    ], false);
  }
  y += 10;

  /* ── Lo que hay que mirar ────────────────────────────────────────────────── */
  const losing = data.profitability.filter(item => item.marginCents < 0);
  const overBudget = data.profitability.filter(item => item.budgetCents > 0 && item.costCents > item.budgetCents);
  if (losing.length || overBudget.length) {
    sectionTitle("Alertas", "Requiere atencion");
    doc.setFontSize(8.6);
    for (const item of losing) {
      ensure(9);
      row([{ text: `- ${clip(item.name, 120)} cierra con margen negativo de ${money(Math.abs(item.marginCents))}.`, x: MARGIN, color: RED }], false);
    }
    for (const item of overBudget) {
      ensure(9);
      row([{ text: `- ${clip(item.name, 110)} ya consumio ${money(item.costCents)} sobre un presupuesto de ${money(item.budgetCents)}.`, x: MARGIN, color: RED }], false);
    }
  }

  footer();
  return `reporte-pinos-${period.from}-a-${period.to}.pdf`;
}
