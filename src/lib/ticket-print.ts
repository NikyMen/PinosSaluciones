import { code128Svg } from "./barcode";
import { COMPANY } from "./pdf-brand";
import { dateTime, money, qty } from "./format";
import { warehouseLabel } from "./warehouses";

/*
 * Impresión en la ticketera (impresora térmica de 58 u 80 mm) y de etiquetas
 * con código de barras. Se imprime con el diálogo del navegador sobre un
 * iframe oculto, con la hoja del ancho del rollo: en la impresora térmica se
 * elige una vez y queda. Sirve igual en la compu del depósito y en el celular.
 */

export type PaperWidth = 58 | 80;

export type TicketLine = { name: string; unit: string; quantity: number; sku?: string; barcode?: string; unitCostCents?: number; totalCents?: number; parts?: Array<{ warehouse: string; quantity: number; remito?: string }> };
export type TicketData = {
  number: string; kind: "ingreso" | "egreso"; date: string; createdAt?: string;
  warehouse?: string; supplierName?: string; destinationLabel?: string; reference?: string; note?: string;
  lines: TicketLine[]; remitos?: Array<{ number: string; warehouse: string }>; totalCents?: number; userName?: string;
};

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

function page(width: PaperWidth, title: string, body: string, extraCss = "") {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escape(title)}</title><style>
    @page { size: ${width}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { width: ${width}mm; padding: 3mm ${width === 58 ? 2 : 3}mm; font: ${width === 58 ? 10 : 11.5}px/1.35 "Courier New", ui-monospace, monospace; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .center { text-align: center; } .right { text-align: right; } b { font-weight: 700; }
    .rule { margin: 5px 0; border-top: 1px dashed #000; }
    .big { font-size: 1.25em; } .small { font-size: .85em; }
    .row { display: flex; justify-content: space-between; gap: 6px; }
    .line { margin: 4px 0; } .line .name { font-weight: 700; word-break: break-word; }
    .barcode svg { display: block; width: 100%; height: 13mm; }
    .sign { margin-top: 12mm; border-top: 1px solid #000; padding-top: 2px; text-align: center; font-size: .85em; }
    ${extraCss}
  </style></head><body>${body}</body></html>`;
}

/** Imprime el HTML en un iframe oculto: sin ventanas emergentes que el navegador bloquee. */
export function printHtml(html: string) {
  return new Promise<void>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) { frame.remove(); return reject(new Error("No se pudo preparar la impresión")); }
    doc.open(); doc.write(html); doc.close();
    const cleanup = () => { setTimeout(() => frame.remove(), 1000); resolve(); };
    win.addEventListener("afterprint", cleanup, { once: true });
    setTimeout(() => {
      try { win.focus(); win.print(); } catch (error) { frame.remove(); return reject(error); }
      // Safari no siempre avisa "afterprint": se limpia igual al rato.
      setTimeout(cleanup, 60_000);
    }, 250);
  });
}

export function ticketHtml(ticket: TicketData, width: PaperWidth) {
  const entry = ticket.kind === "ingreso";
  const units = ticket.lines.reduce((total, line) => total + Number(line.quantity || 0), 0);
  const lines = ticket.lines.map(line => {
    const from = !entry && line.parts && line.parts.length > 1 ? `<div class="small">${line.parts.map(part => `${qty(part.quantity)} del ${escape(warehouseLabel(part.warehouse))}`).join(" + ")}</div>` : "";
    const code = line.barcode || line.sku ? `<div class="small">Cód. ${escape(line.barcode || line.sku)}</div>` : "";
    const price = entry ? `<div class="row small"><span>${qty(line.quantity)} x ${money(line.unitCostCents || 0)}</span><b>${money(line.totalCents || 0)}</b></div>` : "";
    return `<div class="line"><div class="name">${qty(line.quantity)} ${escape(line.unit)} · ${escape(line.name)}</div>${code}${from}${price}</div>`;
  }).join("");
  const remitos = ticket.remitos?.length ? `<div>Remito${ticket.remitos.length > 1 ? "s" : ""}: ${ticket.remitos.map(remito => `<b>${escape(remito.number)}</b> (${escape(warehouseLabel(remito.warehouse))})`).join(", ")}</div>` : "";
  const body = `
    <div class="center"><b class="big">${escape(COMPANY.brand.toUpperCase())}</b><div class="small">${escape(COMPANY.address)}</div></div>
    <div class="rule"></div>
    <div class="center"><b>${entry ? "ENTRADA DE MATERIALES" : "SALIDA A OBRA"}</b><div>Comprobante <b>${escape(ticket.number)}</b></div><div>${escape(dateTime(ticket.createdAt || ticket.date))} hs</div></div>
    <div class="rule"></div>
    ${entry ? `<div>Entra a: <b>${escape(warehouseLabel(ticket.warehouse))}</b></div>${ticket.supplierName ? `<div>Proveedor: ${escape(ticket.supplierName)}</div>` : ""}${ticket.reference ? `<div>Comprobante: ${escape(ticket.reference)}</div>` : ""}`
      : `<div>Destino: <b>${escape(ticket.destinationLabel || "Obra")}</b></div>${remitos}`}
    <div class="rule"></div>
    ${lines}
    <div class="rule"></div>
    <div class="row"><span>Materiales: ${ticket.lines.length}</span><span>Unidades: ${qty(units)}</span></div>
    ${entry ? `<div class="row big"><b>TOTAL</b><b>${money(ticket.totalCents || 0)}</b></div><div class="small">Costo sin IVA</div>` : ""}
    ${ticket.note ? `<div class="rule"></div><div class="small">Obs.: ${escape(ticket.note)}</div>` : ""}
    <div class="rule"></div>
    <div class="small">Preparó: ${escape(ticket.userName || "")}</div>
    ${entry ? "" : `<div class="sign">Recibió (firma, aclaración y DNI)</div>`}
    <div class="barcode" style="margin-top:8px">${code128Svg(ticket.number, { height: 50 })}</div>
    <div class="center small">${escape(ticket.number)} · Documento no válido como factura</div>`;
  return page(width, `Ticket ${ticket.number}`, body);
}

export function printTicket(ticket: TicketData, width: PaperWidth) {
  return printHtml(ticketHtml(ticket, width));
}

export type LabelData = { name: string; code: string; unit?: string; copies?: number };

/** Etiquetas con el código de barras, una debajo de la otra en el rollo, con corte entre cada una. */
export function labelsHtml(labels: LabelData[], width: PaperWidth) {
  const body = labels.flatMap(label => Array.from({ length: Math.max(1, Math.min(100, label.copies || 1)) }, () => `
    <section class="label">
      <div class="label-name">${escape(label.name)}</div>
      <div class="barcode">${code128Svg(label.code, { height: 50 })}</div>
      <div class="row small"><b>${escape(label.code)}</b><span>${escape(label.unit || "")}</span></div>
    </section>`)).join("");
  return page(width, "Etiquetas", body, `
    body { padding: 0 ${width === 58 ? 2 : 3}mm; }
    .label { padding: 3mm 0; break-inside: avoid; page-break-inside: avoid; border-bottom: 1px dashed #999; }
    .label:last-child { border-bottom: 0; }
    .label-name { max-height: 2.8em; overflow: hidden; font-weight: 700; line-height: 1.35; }
    .label .barcode svg { height: ${width === 58 ? 12 : 15}mm; margin: 2px 0; }`);
}

export function printLabels(labels: LabelData[], width: PaperWidth) {
  return printHtml(labelsHtml(labels, width));
}

/* El ancho del rollo y si el ticket sale solo se recuerdan en cada equipo. */
const SETTINGS_KEY = "pino.caja.printer";
export type PrinterSettings = { width: PaperWidth; autoPrint: boolean };

export function readPrinterSettings(): PrinterSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Partial<PrinterSettings>;
    return { width: saved.width === 58 ? 58 : 80, autoPrint: saved.autoPrint === true };
  } catch { return { width: 80, autoPrint: false }; }
}

export function savePrinterSettings(settings: PrinterSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* sin almacenamiento: vale para esta vez */ }
}
