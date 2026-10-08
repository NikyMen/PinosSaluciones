import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { unzipSync, strFromU8 } from "fflate";

/*
 * El PDF único "OC con adjuntos" y el expediente ZIP se arman en el navegador.
 * Acá se simulan `fetch` (los adjuntos subidos) y la descarga, y se revisa lo
 * que quedó adentro.
 */

const { downloadDossierZip, downloadOrderWithAttachments } = await import("../src/lib/purchase-dossier");

const downloads: Array<{ name: string; bytes: Uint8Array }> = [];
const files = new Map<string, Uint8Array>();
// Un PNG de 1x1.
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), char => char.charCodeAt(0));

async function twoPagePdf() {
  const doc = await PDFDocument.create();
  doc.addPage(); doc.addPage();
  return doc.save();
}

beforeEach(async () => {
  downloads.length = 0;
  files.set("/api/uploads/presupuesto.pdf", await twoPagePdf());
  files.set("/api/uploads/foto.png", png);
  files.set("/api/uploads/planilla.xlsx", new Uint8Array([1, 2, 3]));
  files.set("/api/uploads/transferencia.pdf", await twoPagePdf());
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.startsWith("/api/payments/")) return new Response(JSON.stringify({ company: "tvp", number: "OP-1", date: "2026-10-08T00:00:00.000Z", status: "pagada", supplier: { name: "Protex" }, amountCents: 100_00, retentionsCents: 0, method: "transferencia" }));
    const body = files.get(url);
    return body ? new Response(body as BodyInit) : new Response("{}", { status: 404 });
  });
  // La descarga: el link guarda el Blob y, al hacer clic, se anota lo que se iba a bajar.
  let pending: Blob | null = null;
  vi.stubGlobal("URL", { createObjectURL: (blob: Blob) => { pending = blob; return "blob:x"; }, revokeObjectURL: () => {} });
  vi.stubGlobal("document", { createElement: () => {
    const link = { href: "", download: "", click: () => { const blob = pending!; void blob.arrayBuffer().then(buffer => downloads.push({ name: link.download, bytes: new Uint8Array(buffer) })); } };
    return link;
  } });
});

afterEach(() => { vi.unstubAllGlobals(); });

const dossier = {
  request: { _id: "r1", number: "SC-1", stage: "solicitud", description: "Membrana", amountCents: 121_00, requestedDate: "2026-10-01", files: [{ path: "/api/uploads/planilla.xlsx", name: "Comparativa.xlsx" }] },
  order: { _id: "o1", number: "OC-1", stage: "orden", description: "Membrana", amountCents: 121_00, requestedDate: "2026-10-02", attachment: "/api/uploads/presupuesto.pdf",
    files: [{ path: "/api/uploads/foto.png", name: "Muestra.png" }, { path: "/api/uploads/viejo.pdf", name: "Reemplazado.pdf", replacedAt: "2026-10-03" }] },
  payments: [{ _id: "p1", number: "OP-1", files: [{ path: "/api/uploads/transferencia.pdf", name: "Transferencia.pdf" }] }],
  receipts: [{ _id: "re1", number: "RE-1", supplierRemito: "0001-45", attachment: "/api/uploads/foto.png" }],
  expenses: [],
  supplier: { _id: "s1", name: "Protex" }, work: null,
};

describe("los papeles de una compra", () => {
  it("la OC con adjuntos: la orden, el PDF y la foto adentro; la planilla listada aparte; lo reemplazado no", async () => {
    const skipped = await downloadOrderWithAttachments(dossier as never);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(skipped).toEqual(["Comparativa.xlsx"]);
    expect(downloads[0].name).toBe("OC-1-con-adjuntos.pdf");
    const merged = await PDFDocument.load(downloads[0].bytes);
    const orderPages = 1;
    // Orden (1) + presupuesto (2) + foto (1) + hoja de lo que no se pudo incluir (1).
    expect(merged.getPageCount()).toBe(orderPages + 2 + 1 + 1);
  });

  it("el expediente ZIP trae solicitud, orden, órdenes de pago, comprobantes, remitos y un índice", async () => {
    const failed = await downloadDossierZip(dossier as never);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(failed).toEqual([]);
    expect(downloads[0].name).toBe("expediente-OC-1.zip");
    const entries = unzipSync(downloads[0].bytes);
    expect(Object.keys(entries).sort()).toEqual([
      "0 Indice.txt",
      "1 Solicitud - adjuntos/Comparativa.xlsx",
      "1 Solicitud SC-1.pdf",
      "2 Orden de compra - adjuntos/Comprobante.pdf",
      "2 Orden de compra - adjuntos/Muestra.png",
      "2 Orden de compra OC-1.pdf",
      "3 Pagos/OP-1/Orden de pago OP-1.pdf",
      "3 Pagos/OP-1/Transferencia.pdf",
      "4 Remitos/0001-45/Comprobante.png",
    ]);
    expect(strFromU8(entries["0 Indice.txt"])).toContain("Proveedor: Protex");
  });
});
