import { purchaseOrderPdfBytes, purchaseOrderPdfData } from "./purchase-order-pdf";
import { paymentOrderPdfBytes, type PaymentOrderPdfData } from "./payment-order-pdf";

/*
 * Los papeles de una compra (requerimiento integral v4, puntos 3 y 5), armados
 * en el navegador:
 *
 * - "OC con adjuntos": un solo PDF con la orden de compra y, detrás, sus
 *   adjuntos que se pueden convertir (PDF y fotos). Lo que no se puede convertir
 *   (un Excel, un DWG) queda listado en una hoja al final.
 * - El expediente en ZIP: solicitud, orden, órdenes de pago, comprobantes,
 *   remitos, facturas y todos los adjuntos, cada uno en su carpeta.
 */

type Doc = Record<string, unknown> & { _id: string };
export type PurchaseDossier = { request: Doc | null; order: Doc | null; payments: Doc[]; receipts: Doc[]; expenses: Doc[]; supplier: Doc | null; work: Doc | null };
type FileRef = { path: string; name?: string; replacedAt?: string };

/** Los adjuntos vigentes de un documento (y el archivo único de antes). */
function activeFiles(doc: Doc | null | undefined): FileRef[] {
  if (!doc) return [];
  const files = ((doc.files as FileRef[] | undefined) || []).filter(file => !file.replacedAt);
  const legacy = typeof doc.attachment === "string" && doc.attachment && !files.some(file => file.path === doc.attachment) ? [{ path: doc.attachment, name: "Comprobante" + extensionOf(doc.attachment) }] : [];
  return [...legacy, ...files];
}

function extensionOf(path: string) {
  const match = /\.[a-z0-9]+$/i.exec(path);
  return match ? match[0].toLowerCase() : "";
}

/** Un nombre de archivo que sirve en cualquier sistema. */
function safe(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "archivo";
}

function withExtension(name: string, path: string) {
  const extension = extensionOf(path);
  return extension && !name.toLowerCase().endsWith(extension) ? `${name}${extension}` : name;
}

async function fetchBytes(path: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`No se pudo bajar ${path}`);
  return new Uint8Array(await response.arrayBuffer());
}

function download(bytes: Uint8Array, filename: string, type: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function orderPdf(dossier: PurchaseDossier, doc: Doc) {
  return purchaseOrderPdfBytes(purchaseOrderPdfData(doc, dossier.supplier, dossier.work));
}

async function paymentPdf(payment: Doc) {
  const response = await fetch(`/api/payments/${payment._id}/document`);
  if (!response.ok) throw new Error(`No se pudo armar la orden de pago ${String(payment.number || "")}`);
  return paymentOrderPdfBytes(await response.json() as PaymentOrderPdfData);
}

/**
 * La orden de compra (o la solicitud, si todavía no hay orden) con sus adjuntos
 * convertibles detrás, en un solo PDF. Devuelve lo que no se pudo convertir.
 */
export async function downloadOrderWithAttachments(dossier: PurchaseDossier) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const main = dossier.order || dossier.request;
  if (!main) throw new Error("No hay documento");
  const merged = await PDFDocument.create();
  const base = await PDFDocument.load((await orderPdf(dossier, main)).bytes);
  for (const page of await merged.copyPages(base, base.getPageIndices())) merged.addPage(page);

  const files = [...activeFiles(dossier.order), ...activeFiles(dossier.request)];
  const skipped: string[] = [];
  const font = await merged.embedFont(StandardFonts.Helvetica);
  for (const file of files) {
    const name = file.name || "Archivo";
    const extension = extensionOf(file.path);
    try {
      const bytes = await fetchBytes(file.path);
      if (extension === ".pdf") {
        const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
        for (const page of await merged.copyPages(source, source.getPageIndices())) merged.addPage(page);
      } else if ([".jpg", ".jpeg", ".png"].includes(extension)) {
        const image = extension === ".png" ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
        const page = merged.addPage([595.28, 841.89]);
        const scale = Math.min((595.28 - 60) / image.width, (841.89 - 90) / image.height, 1);
        page.drawImage(image, { x: (595.28 - image.width * scale) / 2, y: 841.89 - 50 - image.height * scale, width: image.width * scale, height: image.height * scale });
        page.drawText(asciiSafe(name), { x: 30, y: 24, size: 9, font, color: rgb(0.4, 0.45, 0.52) });
      } else skipped.push(name);
    } catch { skipped.push(name); }
  }
  if (skipped.length) {
    const page = merged.addPage([595.28, 841.89]);
    page.drawText("Adjuntos que no se pueden incluir en el PDF", { x: 40, y: 790, size: 14, font, color: rgb(0, 0.19, 0.36) });
    page.drawText("Se descargan aparte desde la compra o en el expediente ZIP.", { x: 40, y: 770, size: 10, font, color: rgb(0.4, 0.45, 0.52) });
    skipped.forEach((name, index) => page.drawText(`- ${asciiSafe(name)}`, { x: 40, y: 740 - index * 16, size: 10, font }));
  }
  download(await merged.save(), `${String(main.number)}-con-adjuntos.pdf`, "application/pdf");
  return skipped;
}

/** Helvetica de los PDF sólo escribe el alfabeto latino básico: lo demás se reemplaza. */
function asciiSafe(text: string) {
  return text.replace(/[^\x20-\x7e -ÿ]/g, "?");
}

/** El expediente completo de la compra en un ZIP, con un índice de lo que tiene. */
export async function downloadDossierZip(dossier: PurchaseDossier) {
  const { zipSync, strToU8 } = await import("fflate");
  const entries: Record<string, Uint8Array> = {};
  const index: string[] = [];
  const failed: string[] = [];
  const add = (path: string, bytes: Uint8Array) => {
    let name = path;
    for (let copy = 2; entries[name]; copy++) name = path.replace(/(\.[^.]+)?$/, ` (${copy})$1`);
    entries[name] = bytes;
    index.push(name);
  };
  const addFiles = async (folder: string, doc: Doc | null | undefined) => {
    for (const file of activeFiles(doc)) {
      try { add(`${folder}/${safe(withExtension(file.name || "archivo", file.path))}`, await fetchBytes(file.path)); }
      catch { failed.push(file.name || file.path); }
    }
  };

  if (dossier.request) {
    const pdf = await orderPdf(dossier, dossier.request);
    add(`1 Solicitud ${safe(String(dossier.request.number))}.pdf`, pdf.bytes);
    await addFiles("1 Solicitud - adjuntos", dossier.request);
  }
  if (dossier.order) {
    const pdf = await orderPdf(dossier, dossier.order);
    add(`2 Orden de compra ${safe(String(dossier.order.number))}.pdf`, pdf.bytes);
    await addFiles("2 Orden de compra - adjuntos", dossier.order);
  }
  for (const payment of dossier.payments) {
    const folder = `3 Pagos/${safe(String(payment.number || "OP"))}`;
    try { add(`${folder}/Orden de pago ${safe(String(payment.number || ""))}.pdf`, (await paymentPdf(payment)).bytes); }
    catch { failed.push(`Orden de pago ${String(payment.number || "")}`); }
    await addFiles(folder, payment);
  }
  for (const receipt of dossier.receipts) await addFiles(`4 Remitos/${safe(String(receipt.supplierRemito || receipt.number))}`, receipt);
  for (const expense of dossier.expenses) await addFiles(`5 Facturas/${safe(String(expense.number || "factura"))}`, expense);

  const main = dossier.order || dossier.request;
  const summary = [
    `Expediente de la compra ${String(dossier.request?.number || "")}${dossier.order ? ` / ${String(dossier.order.number)}` : ""}`,
    `Proveedor: ${String(dossier.supplier?.name || "-")}`,
    `Armado el ${new Date().toLocaleString("es-AR")}`,
    "", "Contenido:", ...index.map(name => `- ${name}`),
    ...(failed.length ? ["", "No se pudieron incluir:", ...failed.map(name => `- ${name}`)] : []),
  ].join("\r\n");
  entries["0 Indice.txt"] = strToU8(summary);
  download(zipSync(entries, { level: 6 }), `expediente-${safe(String(main?.number || "compra"))}.zip`, "application/zip");
  return failed;
}
