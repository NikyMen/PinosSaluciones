import type { jsPDF } from "jspdf";
import { dateTime } from "./format";

/*
 * Lo que comparten todos los PDF de la empresa: el membrete con los datos
 * legales, el logo, la marca de agua y el pie. Sigue el modelo de las órdenes
 * de compra del sistema anterior: membrete blanco con el logo a la izquierda,
 * el tipo de documento y su número a la derecha, y el logo de PINO muy suave
 * atrás de todo.
 */

export const COMPANY = {
  legalName: "Trabajos Verticales Pino S.A.S.",
  brand: "Pino Soluciones Técnicas",
  address: "Av. Maipú 1278 - 3400 - Corrientes",
  vat: "IVA Responsable Inscripto",
  cuit: "30-71629563-6",
  iibb: "30-71629563-6",
  since: "10/2022",
};

export type Rgb = [number, number, number];
export const NAVY: Rgb = [0, 48, 91];
export const RED: Rgb = [224, 0, 16];
export const INK: Rgb = [23, 34, 53];
export const MUTED: Rgb = [105, 115, 134];
export const LINE: Rgb = [223, 229, 236];

export const PAGE = { width: 210, height: 297, margin: 14, bottom: 272, contentTop: 48 };

/** Las fuentes base del PDF no traen algunos caracteres: el espacio duro del `Intl`, el ·, los superíndices. */
export function plain(text: string) {
  return text.replace(/[  ]/g, " ").replace(/·/g, "-").replace(/²/g, "2").replace(/³/g, "3").replace(/[“”]/g, "\"");
}

/** El logo para los PDF, liviano (26 KB), como lo pide jsPDF. Sólo en el navegador. */
export async function readPdfLogo() {
  try {
    const blob = await (await fetch("/brand/pino-logo-pdf.jpg")).blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("logo"));
      reader.readAsDataURL(blob);
    });
  } catch { return undefined; }
}

function addLogo(doc: jsPDF, logo: string, x: number, y: number, size: number) {
  try { doc.addImage(logo, logo.startsWith("data:image/png") ? "PNG" : "JPEG", x, y, size, size, "pino-logo", "FAST"); }
  catch { /* si el logo no carga, el papel sale igual */ }
}

/** El logo de PINO grande y casi transparente, atrás de todo. Va primero en cada hoja. */
export function drawWatermark(doc: jsPDF, logo?: string) {
  if (!logo) return;
  const size = 128;
  const GState = (doc as unknown as { GState: new (options: { opacity: number }) => unknown }).GState;
  doc.setGState(new GState({ opacity: 0.07 }));
  addLogo(doc, logo, (PAGE.width - size) / 2, (PAGE.height - size) / 2 + 8, size);
  doc.setGState(new GState({ opacity: 1 }));
}

/**
 * El membrete: logo y datos de la empresa a la izquierda; qué documento es, su
 * número y sus datos a la derecha. Deja el cursor en `PAGE.contentTop`.
 */
export function drawLetterhead(doc: jsPDF, options: { title: string; number?: string; lines?: string[]; logo?: string }) {
  const { margin, width } = PAGE;
  const color = ([r, g, b]: Rgb) => doc.setTextColor(r, g, b);
  drawWatermark(doc, options.logo);

  const textLeft = options.logo ? margin + 27 : margin;
  if (options.logo) addLogo(doc, options.logo, margin, 7, 24);
  color(NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text(plain(COMPANY.legalName), textLeft, 13.5);
  color(RED);
  doc.setFontSize(7.6);
  doc.text(plain(COMPANY.brand.toUpperCase()), textLeft, 18.5);
  color(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  doc.text(plain(COMPANY.address), textLeft, 23);
  doc.text(plain(COMPANY.vat), textLeft, 27);

  // El tipo de documento con las letras separadas, como en los comprobantes de antes.
  color(NAVY);
  doc.setFont("helvetica", "bold");
  // El título no puede pisar el nombre de la empresa: si es largo ("Liquidación
  // de mano de obra") se achica la letra y el espacio entre letras hasta que entre.
  // jsPDF no cuenta ese espacio al alinear a la derecha: se mide a mano.
  const title = plain(options.title.toUpperCase());
  doc.setFontSize(11.5);
  const available = width - margin - (textLeft + doc.getTextWidth(plain(COMPANY.legalName)) + 8);
  let size = 12.5;
  let spacing = 1.1;
  const measure = () => { doc.setFontSize(size); return doc.getTextWidth(title) + spacing * (title.length - 1); };
  while (measure() > available && size > 8.5) { size -= 0.5; spacing = Math.max(0.3, spacing - 0.2); }
  const titleWidth = measure();
  doc.setCharSpace(spacing);
  doc.text(title, width - margin - titleWidth, 13.5);
  doc.setCharSpace(0);
  let right = 19.5;
  if (options.number) {
    color(INK);
    doc.setFontSize(10.5);
    doc.text(plain(options.number), width - margin, right, { align: "right" });
    right += 5;
  }
  color(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.8);
  for (const line of options.lines || []) {
    doc.text(plain(line), width - margin, right, { align: "right" });
    right += 4.2;
  }

  // Los datos fiscales en una línea, y abajo la raya azul con el tramo rojo de la marca.
  doc.setFontSize(7);
  doc.text(plain(`CUIT ${COMPANY.cuit}   ·   Ingresos Brutos ${COMPANY.iibb}   ·   Inicio de actividades ${COMPANY.since}`), margin, 35);
  const [nr, ng, nb] = NAVY; const [rr, rg, rb] = RED;
  doc.setFillColor(nr, ng, nb);
  doc.rect(margin, 38, width - margin * 2, 0.7, "F");
  doc.setFillColor(rr, rg, rb);
  doc.rect(margin, 38, 42, 0.7, "F");
  return PAGE.contentTop;
}

/** El pie de cada hoja: quién lo generó, cuándo, y el número de página. */
export function drawFooter(doc: jsPDF, options: { page: number; author: string; note?: string }) {
  const { margin, width } = PAGE;
  const [lr, lg, lb] = LINE; const [mr, mg, mb] = MUTED;
  doc.setFillColor(lr, lg, lb);
  doc.rect(margin, 282, width - margin * 2, 0.3, "F");
  doc.setTextColor(mr, mg, mb);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.text(plain(`${COMPANY.legalName} - ${options.note ? `${options.note} - ` : ""}Generado por ${options.author} el ${dateTime(new Date())}`), margin, 287);
  doc.text(`Página ${options.page}`, width - margin, 287, { align: "right" });
}

/* ── Importe en letras, para el "Son pesos" ────────────────────────────────── */

const UNITS = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function belowThousand(value: number): string {
  if (value === 0) return "";
  if (value === 100) return "cien";
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const parts = [HUNDREDS[hundreds]];
  if (rest < 30) parts.push(UNITS[rest]);
  else parts.push(TENS[Math.floor(rest / 10)] + (rest % 10 ? ` y ${UNITS[rest % 10]}` : ""));
  return parts.filter(Boolean).join(" ");
}

/** "Uno" se apocopa delante de "mil" y "millones": un mil, veintiún mil, treinta y un millones. */
const apocope = (text: string) => text.endsWith("veintiuno") ? text.replace(/veintiuno$/, "veintiún") : text.replace(/uno$/, "un");

function integerInWords(value: number): string {
  if (value === 0) return "cero";
  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1000);
  const rest = value % 1000;
  const parts: string[] = [];
  if (millions) parts.push(millions === 1 ? "un millón" : `${apocope(integerInWords(millions))} millones`);
  if (thousands) parts.push(thousands === 1 ? "mil" : `${apocope(belowThousand(thousands))} mil`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** 486648 centavos → "Pesos cuatro mil ochocientos sesenta y seis con 48/100". */
export function amountInWords(cents: number) {
  const whole = Math.floor(Math.abs(cents) / 100);
  const decimals = Math.abs(Math.round(cents)) % 100;
  const words = integerInWords(whole);
  return `Pesos ${words} con ${String(decimals).padStart(2, "0")}/100`;
}
