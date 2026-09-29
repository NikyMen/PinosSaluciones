import type { jsPDF } from "jspdf";
import { date, money, qty } from "./format";
import { drawFooter, drawLetterhead, INK, LINE, MUTED, NAVY, PAGE, plain, readPdfLogo, type Rgb } from "./pdf-brand";
import type { PayrollRow } from "./payroll";
import { unitLabels } from "./work-type-labels";

/**
 * La liquidación de la quincena en papel: primero el resumen (legajo, persona,
 * horas y total a pagar) y después el detalle de cada persona, día por día.
 */

const { margin: MARGIN, width: WIDTH, bottom: BOTTOM } = PAGE;
const INNER = WIDTH - MARGIN * 2;

export type PayrollPdfData = { from: string; to: string; rows: PayrollRow[]; totals: { people: number; hours: number; cents: number } };

export function buildPayrollPdf(doc: jsPDF, data: PayrollPdfData, meta: { author: string; logo?: string }) {
  const setColor = ([r, g, b]: Rgb) => doc.setTextColor(r, g, b);
  const setFill = ([r, g, b]: Rgb) => doc.setFillColor(r, g, b);
  let page = 1;
  const header = () => drawLetterhead(doc, {
    title: "Liquidación de quincena", logo: meta.logo,
    lines: [`Del ${date(data.from)} al ${date(data.to)}`, `${data.totals.people} personas · ${money(data.totals.cents)}`],
  });
  let y = header();
  const ensure = (space: number) => { if (y + space > BOTTOM) { drawFooter(doc, { page, author: meta.author }); doc.addPage(); page += 1; y = header() + 4; } };
  const head = (columns: Array<[label: string, x: number, align?: "left" | "right"]>) => {
    setFill([237, 241, 246]); doc.rect(MARGIN, y - 5, INNER, 8, "F");
    setColor(MUTED); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
    for (const [label, x, align] of columns) doc.text(label, x, y, { align: align || "left" });
    y += 8;
  };

  // Resumen.
  head([["LEGAJO", MARGIN + 2], ["APELLIDO Y NOMBRE", MARGIN + 20], ["PUESTO", 100], ["HORAS", 160, "right"], ["A PAGAR", WIDTH - MARGIN - 2, "right"]]);
  data.rows.forEach((row, index) => {
    ensure(8);
    if (index % 2 === 1) { setFill([250, 251, 253]); doc.rect(MARGIN, y - 4.6, INNER, 7, "F"); }
    setColor(INK); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(row.fileNumber ? String(row.fileNumber) : "-", MARGIN + 2, y);
    doc.setFont("helvetica", "bold");
    doc.text(plain(row.name).slice(0, 42), MARGIN + 20, y);
    doc.setFont("helvetica", "normal"); setColor(MUTED); doc.setFontSize(7.4);
    doc.text(plain(row.position || "-").slice(0, 34), 100, y);
    setColor(INK); doc.setFontSize(8);
    doc.text(qty(row.hours), 160, y, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(plain(money(row.totalCents)), WIDTH - MARGIN - 2, y, { align: "right" });
    y += 7;
  });
  ensure(12);
  setFill(LINE); doc.rect(MARGIN, y - 2.5, INNER, 0.4, "F");
  y += 4;
  setColor(NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
  doc.text("TOTAL DE LA QUINCENA", MARGIN + 20, y);
  doc.text(qty(data.totals.hours), 160, y, { align: "right" });
  doc.text(plain(money(data.totals.cents)), WIDTH - MARGIN - 2, y, { align: "right" });
  y += 12;

  // Detalle por persona.
  for (const row of data.rows) {
    ensure(22);
    setColor(NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text(plain(`${row.fileNumber ? `Legajo ${row.fileNumber} · ` : ""}${row.name}`), MARGIN, y);
    doc.text(plain(money(row.totalCents)), WIDTH - MARGIN - 2, y, { align: "right" });
    y += 6;
    head([["DÍA", MARGIN + 2], ["OBRA", MARGIN + 22], ["TIPO DE TRABAJO", 92], ["CANT.", 146, "right"], ["TARIFA", 170, "right"], ["IMPORTE", WIDTH - MARGIN - 2, "right"]]);
    for (const line of row.lines) {
      ensure(7);
      setColor(INK); doc.setFont("helvetica", "normal"); doc.setFontSize(7.6);
      doc.text(date(line.date), MARGIN + 2, y);
      doc.text(plain(line.workCode || line.workName).slice(0, 34), MARGIN + 22, y);
      doc.text(plain(line.workType).slice(0, 30), 92, y);
      doc.text(`${qty(line.quantity)} ${unitLabels[line.unit]?.short || ""}`.trim(), 146, y, { align: "right" });
      doc.text(plain(money(line.rateCents)), 170, y, { align: "right" });
      doc.text(plain(money(line.costCents)), WIDTH - MARGIN - 2, y, { align: "right" });
      y += 5.6;
    }
    y += 5;
  }

  drawFooter(doc, { page, author: meta.author, note: "Liquidación de quincena" });
  return `liquidacion-${data.from.slice(0, 10)}-a-${data.to.slice(0, 10)}.pdf`;
}

export async function downloadPayrollPdf(data: PayrollPdfData) {
  const [{ jsPDF }, logo, session] = await Promise.all([
    import("jspdf"),
    readPdfLogo(),
    fetch("/api/auth/me").then(response => response.ok ? response.json() : null).catch(() => null),
  ]);
  const doc = new jsPDF();
  const filename = buildPayrollPdf(doc, data, { author: session?.name || "el sistema", logo });
  doc.save(filename);
}
