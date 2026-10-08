import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";

const session = { userId: new Types.ObjectId().toHexString(), name: "Gerencia de prueba", email: "gerencia@test.local", role: "gerencia" as const, permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { Client, Quote, Work, Task, SalesRemito, StockItem } = await import("../src/lib/models");
const recordsRoute = await import("../src/app/api/records/[entity]/route");
const recordRoute = await import("../src/app/api/records/[entity]/[id]/route");
const convertRoute = await import("../src/app/api/quotes/[id]/convert/route");
const certificatesRoute = await import("../src/app/api/works/[id]/certificates/route");
const draftRoute = await import("../src/app/api/invoices/draft/route");
const { claimRemitos } = await import("../src/lib/sales-remitos");
const { netFromGross, quoteNetCents } = await import("../src/lib/net-amounts");
const { computeCascade } = await import("../src/lib/cascada");

let server: MongoMemoryServer;
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const json = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("certificados");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("el certificado se calcula sobre el neto", () => {
  it("la cotización a mano guarda su neto y la obra lo hereda", async () => {
    const client = await Client.create({ name: "Consorcio Neto" });
    const created = await call(await recordsRoute.POST(json("POST", { clientId: String(client._id), title: "Pintura", amountCents: 1_210_000_00, status: "aprobada" }), params({ entity: "quotes" })));
    expect(created.status).toBe(201);
    expect(created.body.netCents).toBe(1_000_000_00);

    // Si se cambia el precio, el neto acompaña.
    const changed = await call(await recordRoute.PATCH(json("PATCH", { amountCents: 2_420_000_00 }), params({ entity: "quotes", id: created.body._id })));
    expect(changed.body.netCents).toBe(2_000_000_00);

    const work = await call(await convertRoute.POST(json("POST", { code: "OB-N1", name: "Pintura" }), params({ id: created.body._id })));
    expect(work.status).toBe(201);
    expect(work.body).toMatchObject({ budgetCents: 2_420_000_00, budgetNetCents: 2_000_000_00 });
  });

  it("con cascada el neto es el subtotal 3, no el precio con IVA", () => {
    const items = [{ code: "1", name: "Revoque", unit: "m2", qty: 100, composition: [{ rubro: "MAT" as const, name: "Cemento", unit: "kg", coefPerUnit: 1, unitPriceCents: 1000 }] }];
    const cascade = computeCascade({ items: items as never });
    expect(quoteNetCents({ items: items as never })).toBe(cascade.subtotal3Cents);
    expect(cascade.subtotal3Cents).toBeLessThan(cascade.priceCents);
    // Guardado, manda el guardado.
    expect(quoteNetCents({ netCents: 123, amountCents: 999 })).toBe(123);
    expect(netFromGross(121_00)).toBe(100_00);
  });

  it("el servidor calcula el importe, no deja pasar del 100 % y la factura lo cierra y lo reabre", async () => {
    const client = await Client.create({ name: "Cliente certificados" });
    const quote = await Quote.create({ number: "COT-N2", clientId: client._id, title: "Fachada", amountCents: 1_210_000_00, netCents: 1_000_000_00, status: "convertida" });
    const work = await Work.create({ code: "OB-N2", name: "Fachada", clientId: client._id, quoteId: quote._id, status: "en_curso", budgetCents: 1_210_000_00 });

    // Una obra de antes, sin neto guardado: se lee con el neto de su cotización.
    const read = await call(await recordRoute.GET(new Request("http://test"), params({ entity: "works", id: String(work._id) })));
    expect(read.body.budgetNetCents).toBe(1_000_000_00);

    const first = await call(await certificatesRoute.POST(json("POST", { number: "C1", period: "Octubre 2026", percentage: 30, approved: true }), params({ id: String(work._id) })));
    expect(first.status).toBe(201);
    const c1 = first.body.certificates.find((item: { number: string }) => item.number === "C1");
    expect(c1.amountCents).toBe(300_000_00);

    // Ya hay un 30 %: el 80 % no entra.
    const tooMuch = await call(await certificatesRoute.POST(json("POST", { number: "C2", period: "Noviembre 2026", percentage: 80, approved: true }), params({ id: String(work._id) })));
    expect(tooMuch.status).toBe(409);
    // El mismo número tampoco.
    expect((await call(await certificatesRoute.POST(json("POST", { number: "C1", period: "Noviembre 2026", percentage: 10 }), params({ id: String(work._id) })))).status).toBe(409);

    // El borrador lo encuentra por id y el neto es el del certificado.
    const draft = (await call(await draftRoute.GET(new Request(`http://test/api/invoices/draft?obra=${work._id}&certificado=${c1._id}`)))).body;
    expect(draft).toMatchObject({ certificateNumber: "C1", certificateId: String(c1._id), netCents: 300_000_00 });

    const invoice = await call(await recordsRoute.POST(json("POST", {
      voucherType: "factura_a", number: "0003-00000500", clientId: String(client._id), workId: String(work._id), certificateNumber: "C1", certificateId: String(c1._id),
      issueDate: "2026-10-08", netCents: 300_000_00, vatPct: 21, status: "pendiente",
    }), params({ entity: "invoices" })));
    expect(invoice.status).toBe(201);
    expect(invoice.body.amountCents).toBe(363_000_00);
    const invoicedFlag = async () => (await Work.findById(work._id).lean<{ certificates: Array<{ number: string; invoiced: boolean }> }>())!.certificates.find(item => item.number === "C1")!.invoiced;
    expect(await invoicedFlag()).toBe(true);
    expect(await Task.findOne({ relatedId: work._id, type: "facturar_certificado" }).lean()).toMatchObject({ status: "completada" });

    // Anulada, el certificado vuelve a estar pendiente de facturar.
    await recordRoute.PATCH(json("PATCH", { status: "anulada" }), params({ entity: "invoices", id: invoice.body._id }));
    expect(await invoicedFlag()).toBe(false);
    expect(await Task.findOne({ relatedId: work._id, type: "facturar_certificado" }).lean()).toMatchObject({ status: "pendiente" });

    // Una factura nueva que lo elige sólo por número lo vuelve a cerrar y queda atada por id; borrada, lo reabre.
    const again = await call(await recordsRoute.POST(json("POST", {
      voucherType: "factura_a", number: "0003-00000501", clientId: String(client._id), workId: String(work._id), certificateNumber: "C1",
      issueDate: "2026-10-09", netCents: 300_000_00, vatPct: 21, status: "pendiente",
    }), params({ entity: "invoices" })));
    expect(await invoicedFlag()).toBe(true);
    const { Invoice } = await import("../src/lib/models");
    expect(String((await Invoice.findById(again.body._id).lean<{ certificateId?: unknown }>())!.certificateId)).toBe(String(c1._id));
    await recordRoute.DELETE(new Request("http://test", { method: "DELETE" }), params({ entity: "invoices", id: again.body._id }));
    expect(await invoicedFlag()).toBe(false);
  });
});

describe("remitos tomados por una sola factura", () => {
  it("si dos facturas quieren el mismo remito a la vez, una se frena", async () => {
    const client = await Client.create({ name: "Cliente remitos" });
    const item = await StockItem.create({ name: "Pegamento", unit: "bolsa", category: "materiales" });
    const remito = await SalesRemito.create({ number: "R-900", clientId: client._id, date: new Date(), lines: [{ stockItemId: item._id, name: "Pegamento", quantity: 4, unitPriceCents: 1000, totalCents: 4000 }], totalCents: 4000 });
    const all = [{ remitoId: String(remito._id), line: 0, quantity: 4 }];
    const results = await Promise.allSettled([claimRemitos(new Types.ObjectId(), all), claimRemitos(new Types.ObjectId(), all)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const after = await SalesRemito.findById(remito._id).lean<{ status: string; invoiceIds: unknown[] }>();
    expect(after).toMatchObject({ status: "facturado" });
    expect(after!.invoiceIds).toHaveLength(1);
  });
});
