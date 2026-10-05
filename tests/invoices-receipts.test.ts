import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";

const session = { userId: new Types.ObjectId().toHexString(), name: "Administración de prueba", email: "admin@test.local", role: "gerencia" as const, permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { Client, Quote, Work, Invoice, Collection, Account } = await import("../src/lib/models");
const recordsRoute = await import("../src/app/api/records/[entity]/route");
const recordRoute = await import("../src/app/api/records/[entity]/[id]/route");
const receiptsRoute = await import("../src/app/api/receipts/route");
const receiptRoute = await import("../src/app/api/receipts/[id]/route");
const trackingRoute = await import("../src/app/api/tracking/route");
const draftRoute = await import("../src/app/api/invoices/draft/route");
const { buildReceiptPdf } = await import("../src/lib/receipt-pdf");

let server: MongoMemoryServer;
// Todo cobro se imputa a una cuenta CI del plan.
let ciAccount = "";
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const json = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("facturas");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
  const { ensureAccountCatalog } = await import("../src/lib/account-service");
  await ensureAccountCatalog();
  ciAccount = String((await Account.findOne({ name: "CI - CERTIFICADOS" }).lean<{ _id: Types.ObjectId }>())!._id);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("facturas de Tango, recibos y seguimiento", () => {
  it("carga la factura con neto e IVA, la ata a la cotización, la cobra con recibos y la sigue de punta a punta", async () => {
    const client = await Client.create({ name: "Consorcio Belgrano", cuit: "30-11111111-1" });
    const other = await Client.create({ name: "Otro cliente" });
    const quote = await Quote.create({ number: "COT-40", clientId: client._id, title: "Fachada Belgrano", amountCents: 3_000_000_00, status: "aprobada" });
    const work = await Work.create({ code: "OB-40", name: "Fachada Belgrano", clientId: client._id, quoteId: quote._id, status: "en_curso", budgetCents: 3_000_000_00 });
    await Quote.create({ number: "COT-41", clientId: client._id, title: "Todavía en borrador", amountCents: 1_000, status: "borrador" });

    // Con la obra elegida, la cotización se completa sola; el total sale del neto más el IVA.
    const first = await call(await recordsRoute.POST(json("POST", {
      voucherType: "factura_a", number: "0003-00000120", clientId: String(client._id), workId: String(work._id),
      issueDate: "2026-09-10", netCents: 1_000_000_00, vatPct: 21, amountCents: 1, status: "pendiente",
    }), params({ entity: "invoices" })));
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ quoteId: String(quote._id), netCents: 1_000_000_00, vatCents: 210_000_00, amountCents: 1_210_000_00, status: "pendiente", collectedCents: 0 });
    // Con la cotización elegida, se completa la obra.
    const second = await call(await recordsRoute.POST(json("POST", {
      voucherType: "factura_a", number: "0003-00000121", clientId: String(client._id), quoteId: String(quote._id),
      issueDate: "2026-09-20", netCents: 500_000_00, vatPct: 21, status: "pendiente",
    }), params({ entity: "invoices" })));
    expect(second.body).toMatchObject({ workId: String(work._id), amountCents: 605_000_00 });

    // El número que sigue.
    expect((await call(await draftRoute.GET(new Request("http://test/api/invoices/draft")))).body.number).toBe("0003-00000122");

    // Un recibo que cobra la primera entera y parte de la segunda.
    const pending = await call(await receiptsRoute.GET(new Request(`http://test/api/receipts?clientId=${client._id}`)));
    expect(pending.body.items.map((row: { label: string; balanceCents: number }) => [row.label, row.balanceCents])).toEqual([["Factura A 0003-00000120", 1_210_000_00], ["Factura A 0003-00000121", 605_000_00]]);
    const receipt = await call(await receiptsRoute.POST(json("POST", { accountId: ciAccount,
      clientId: String(client._id), date: "2026-09-25", method: "transferencia", reference: "TRF 991",
      allocations: [{ invoiceId: first.body._id, amountCents: 1_210_000_00 }, { invoiceId: second.body._id, amountCents: 105_000_00 }],
    })));
    expect(receipt.status).toBe(201);
    expect(receipt.body.receipt).toMatchObject({ number: "RC-1", amountCents: 1_315_000_00, userName: "Administración de prueba" });
    expect(receipt.body.pdf).toMatchObject({ number: "RC-1", client: { name: "Consorcio Belgrano" }, totalCents: 1_315_000_00, lines: [{ label: "Factura A 0003-00000120", appliedCents: 1_210_000_00, quoteNumber: "COT-40" }, { appliedCents: 105_000_00 }] });
    expect(await Invoice.findById(first.body._id).lean()).toMatchObject({ collectedCents: 1_210_000_00, status: "cobrada" });
    expect(await Invoice.findById(second.body._id).lean()).toMatchObject({ collectedCents: 105_000_00, status: "parcial" });

    // No se cobra de más, ni una factura de otro cliente.
    const tooMuch = await call(await receiptsRoute.POST(json("POST", { accountId: ciAccount, clientId: String(client._id), date: "2026-09-26", method: "efectivo", allocations: [{ invoiceId: second.body._id, amountCents: 600_000_00 }] })));
    expect(tooMuch.status).toBe(409);
    const wrongClient = await call(await receiptsRoute.POST(json("POST", { accountId: ciAccount, clientId: String(other._id), date: "2026-09-26", method: "efectivo", allocations: [{ invoiceId: second.body._id, amountCents: 1_00 }] })));
    expect(wrongClient.status).toBe(409);
    const noDate = await call(await receiptsRoute.POST(json("POST", { accountId: ciAccount, clientId: String(client._id), method: "efectivo", allocations: [{ invoiceId: second.body._id, amountCents: 1_00 }] })));
    expect(noDate.status).toBe(400);

    // Editar el recibo: deshace lo aplicado y aplica lo nuevo (al editar, lo suyo vuelve a contar como saldo).
    const editing = await call(await receiptsRoute.GET(new Request(`http://test/api/receipts?clientId=${client._id}&receipt=${receipt.body.receipt._id}`)));
    expect(editing.body.items.find((row: { _id: string }) => row._id === first.body._id)).toMatchObject({ balanceCents: 1_210_000_00, appliedCents: 1_210_000_00 });
    const edited = await call(await receiptRoute.PUT(json("PUT", {
      accountId: ciAccount, clientId: String(client._id), date: "2026-09-25", method: "transferencia",
      allocations: [{ invoiceId: first.body._id, amountCents: 1_210_000_00 }, { invoiceId: second.body._id, amountCents: 605_000_00 }],
    }), params({ id: receipt.body.receipt._id })));
    expect(edited.status).toBe(200);
    expect(edited.body.receipt).toMatchObject({ number: "RC-1", amountCents: 1_815_000_00 });
    expect(await Invoice.findById(second.body._id).lean()).toMatchObject({ collectedCents: 605_000_00, status: "cobrada" });

    // El seguimiento: una línea por cotización aprobada, con sus facturas y recibos.
    const tracking = await call(await trackingRoute.GET());
    const row = tracking.body.items.find((item: { quote: { number: string } | null }) => item.quote?.number === "COT-40");
    expect(row).toMatchObject({
      client: { name: "Consorcio Belgrano" }, works: [{ code: "OB-40" }],
      invoicedCents: 1_815_000_00, collectedCents: 1_815_000_00, balanceCents: 0, toInvoiceCents: 1_185_000_00, state: "facturado_parcial",
      receipts: [{ number: "RC-1", amountCents: 1_815_000_00 }],
    });
    expect(row.invoices.map((invoice: { label: string }) => invoice.label)).toEqual(["Factura A 0003-00000120", "Factura A 0003-00000121"]);
    expect(tracking.body.items.some((item: { quote: { number: string } | null }) => item.quote?.number === "COT-41")).toBe(false);

    // Borrar el recibo devuelve el saldo a las facturas.
    await recordRoute.DELETE(new Request("http://test", { method: "DELETE" }), params({ entity: "collections", id: receipt.body.receipt._id }));
    expect(await Invoice.findById(first.body._id).lean()).toMatchObject({ collectedCents: 0, status: "pendiente" });
    expect(await Invoice.findById(second.body._id).lean()).toMatchObject({ collectedCents: 0, status: "pendiente" });

    // El próximo recibo sigue la numeración, y sin facturas queda como pago a cuenta.
    const onAccount = await call(await receiptsRoute.POST(json("POST", { accountId: ciAccount, clientId: String(other._id), date: "2026-09-27", method: "efectivo", amountCents: 50_000_00 })));
    expect(onAccount.body.receipt).toMatchObject({ number: "RC-2", amountCents: 50_000_00 });
    expect(await Collection.countDocuments()).toBe(1);
  });

  it("una factura vieja cargada solo con el total no cambia su importe al editarla", async () => {
    const client = await Client.create({ name: "Cliente viejo" });
    const legacy = await Invoice.create({ number: "A-77", clientId: client._id, issueDate: new Date(), amountCents: 12_345_67, collectedCents: 12_345_67, status: "cobrada" });
    const patched = await call(await recordRoute.PATCH(json("PATCH", { description: "Corregida", amountCents: 12_345_67, netCents: 0, vatPct: 0 }), params({ entity: "invoices", id: String(legacy._id) })));
    expect(patched.body).toMatchObject({ amountCents: 12_345_67, status: "cobrada", description: "Corregida" });
    // Anulada queda anulada.
    const voided = await call(await recordRoute.PATCH(json("PATCH", { status: "anulada" }), params({ entity: "invoices", id: String(legacy._id) })));
    expect(voided.body.status).toBe("anulada");
  });

  it("el PDF del recibo se arma con las facturas que cancela", async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    const filename = buildReceiptPdf(doc, {
      company: "constructora", number: "RC-9", date: "2026-09-25T00:00:00.000Z", method: "cheque", account: "Banco Nación", reference: "Ch. 123", notes: "", userName: "Fernando",
      client: { name: "Consorcio", cuit: "30-1", address: "Corrientes" },
      lines: [{ label: "Factura A 0003-00000120", issueDate: "2026-09-10T00:00:00.000Z", invoiceCents: 100_00, appliedCents: 100_00, quoteNumber: "COT-1" }],
      totalCents: 100_00,
    }, { author: "Fernando" });
    expect(filename).toBe("recibo-RC-9.pdf");
    expect(doc.getNumberOfPages()).toBe(1);
  });
});

describe("empresa que factura", () => {
  it("numera por empresa y no mezcla empresas en un recibo", async () => {
    const client = await Client.create({ name: "Cliente dos empresas" });
    const tvp = await call(await recordsRoute.POST(json("POST", { company: "tvp", voucherType: "factura_a", number: "0003-00000500", clientId: String(client._id), issueDate: "2026-09-29", netCents: 100_00, vatPct: 21, status: "pendiente" }), params({ entity: "invoices" })));
    const constructora = await call(await recordsRoute.POST(json("POST", { company: "constructora", voucherType: "factura_a", number: "0005-00000077", clientId: String(client._id), issueDate: "2026-09-29", netCents: 200_00, vatPct: 21, status: "pendiente" }), params({ entity: "invoices" })));
    expect([tvp.body.company, constructora.body.company]).toEqual(["tvp", "constructora"]);
    // Cada empresa sigue su numeración.
    const draft = (await call(await draftRoute.GET(new Request("http://test/api/invoices/draft")))).body;
    expect(draft).toMatchObject({ company: "tvp", number: "0003-00000501", numbers: { tvp: { factura_a: "0003-00000501", factura_x: "X-0001-00000001" }, constructora: { factura_a: "0005-00000078" } } });
    // Un recibo es de una sola empresa.
    const mixed = await call(await receiptsRoute.POST(json("POST", { accountId: ciAccount, clientId: String(client._id), date: "2026-09-30", method: "efectivo", allocations: [{ invoiceId: tvp.body._id, amountCents: 121_00 }, { invoiceId: constructora.body._id, amountCents: 242_00 }] })));
    expect(mixed).toMatchObject({ status: 409, body: { error: expect.stringContaining("una sola empresa") } });
    const ok = await call(await receiptsRoute.POST(json("POST", { accountId: ciAccount, clientId: String(client._id), date: "2026-09-30", method: "efectivo", allocations: [{ invoiceId: constructora.body._id, amountCents: 242_00 }] })));
    expect(ok.body.pdf.company).toBe("constructora");
  });
});

describe("empresa desde la cotización, sectores y datos bancarios", () => {
  it("la factura del certificado toma la empresa de la cotización", async () => {
    const client = await Client.create({ name: "Cliente constructora" });
    const quote = await Quote.create({ number: "COT-90", clientId: client._id, title: "Obra constructora", amountCents: 1_000_00, status: "aprobada", company: "constructora" });
    const work = await Work.create({ code: "OB-90", name: "Obra constructora", clientId: client._id, quoteId: quote._id, status: "en_curso", certificates: [{ number: "C1", period: "Sep", percentage: 10, amountCents: 100_00, approved: true }] });
    const draft = (await call(await draftRoute.GET(new Request(`http://test/api/invoices/draft?obra=${work._id}&certificado=C1`)))).body;
    expect(draft).toMatchObject({ company: "constructora", quoteId: String(quote._id), netCents: 100_00 });
  });

  it("un bien de uso sin sector es de uso general", async () => {
    const created = await call(await recordsRoute.POST(json("POST", { name: "Fiat Fiorino", category: "vehiculo", status: "activo" }), params({ entity: "assets" })));
    expect(created.body.sector).toBe("general");
    const scaffold = await call(await recordsRoute.POST(json("POST", { name: "Silleta", category: "herramienta", status: "activo", sector: "altura" }), params({ entity: "assets" })));
    expect(scaffold.body.sector).toBe("altura");
  });

  it("los datos para transferir salen solo cuando están cargados", async () => {
    const { bankLines, COMPANIES } = await import("../src/lib/companies");
    expect(bankLines(COMPANIES.tvp)).toEqual([]);
    expect(bankLines({ ...COMPANIES.constructora, bank: "Banco Nación", cbu: "0110000000000000000000", alias: "PINO.CONSTRUCTORA" }))
      .toEqual(["Datos para transferir a Constructora Pino S.R.L.: Banco Nación · CBU 0110000000000000000000 · Alias PINO.CONSTRUCTORA"]);
  });
});
