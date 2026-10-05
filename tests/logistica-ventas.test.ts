import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";

const session = { userId: new Types.ObjectId().toHexString(), name: "Depósito", email: "deposito@test.local", role: "gerencia" as const, permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { Client, Expense, Notification, Purchase, Quote, SalesRemito, StockItem, StockReservation, Supplier, Work } = await import("../src/lib/models");
const movements = await import("../src/app/api/stock/[id]/movements/route");
const transfersRoute = await import("../src/app/api/transfers/route");
const transferReceive = await import("../src/app/api/transfers/[id]/receive/route");
const transferCancel = await import("../src/app/api/transfers/[id]/cancel/route");
const remitosRoute = await import("../src/app/api/remitos/route");
const remitoReturn = await import("../src/app/api/remitos/[id]/return/route");
const remitoCancel = await import("../src/app/api/remitos/[id]/cancel/route");
const recordsRoute = await import("../src/app/api/records/[entity]/route");
const recordRoute = await import("../src/app/api/records/[entity]/[id]/route");
const draftRoute = await import("../src/app/api/invoices/draft/route");
const quoteStock = await import("../src/app/api/quotes/[id]/stock/route");
const routeApi = await import("../src/app/api/purchase-route/route");

let server: MongoMemoryServer;
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const json = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("logistica");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

async function material(name: string, central: number, owner: "tvp" | "constructora" = "tvp") {
  const item = await StockItem.create({ name, unit: "bolsa", category: "materiales" });
  if (central) await call(await movements.POST(json("POST", { kind: "ingreso", warehouse: "central", owner, quantity: central, unitCostCents: 10_000 }), params({ id: String(item._id) })));
  return String(item._id);
}

describe("venta al público: Central → Salón → remito → factura", () => {
  it("transfiere con diferencias, vende desde el Salón y factura el remito sin volver a descontar", async () => {
    const cemento = await material("Cemento 50 kg", 20, "constructora");
    const cal = await material("Cal 25 kg", 10, "tvp");

    // Transferencia de dos materiales: queda en tránsito.
    const sent = await call(await transfersRoute.POST(json("POST", { from: "central", to: "salon", lines: [{ itemId: cemento, quantity: 10 }, { itemId: cal, quantity: 4 }] })));
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ status: "en_transito", from: "central", to: "salon" });
    expect(await StockItem.findById(cemento).lean()).toMatchObject({ qty_central: 10, qty_salon: 0, transitQty: 10, quantity: 20 });
    expect(await Notification.exists({ dedupeKey: `transfer-${sent.body._id}` })).toBeTruthy();

    // Llegan 8 bien y 1 roto; falta 1. La cal llega completa.
    const received = await call(await transferReceive.POST(json("POST", { lines: [{ itemId: cemento, receivedQty: 8, damagedQty: 1, note: "una bolsa rota" }, { itemId: cal, receivedQty: 4 }] }), params({ id: sent.body._id })));
    expect(received.body.status).toBe("con_diferencias");
    expect(received.body.lines[0]).toMatchObject({ receivedQty: 8, damagedQty: 1, missingQty: 1 });
    const afterReception = await StockItem.findById(cemento).lean<Record<string, unknown>>();
    expect(afterReception).toMatchObject({ qty_central: 10, qty_salon: 8, transitQty: 0, unusableQty: 1, quantity: 18 });
    // Lo que llegó conserva su dueño: es de la Constructora.
    expect((afterReception!.owners as Record<string, unknown>).salon).toEqual({ constructora: 8 });

    // No se vende más de lo que hay en el Salón (aunque haya en el Central).
    const client = await Client.create({ name: "Corralón vecino", cuit: "20-44444444-4" });
    const tooMuch = await call(await remitosRoute.POST(json("POST", { company: "tvp", clientId: String(client._id), date: "2026-10-05", lines: [{ itemId: cemento, quantity: 9, unitPriceCents: 15_000 }] })));
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error).toContain("transferirlo");

    // Remito de venta: lo factura TV Pino aunque el material sea de la Constructora (CUIT facturante ≠ propietario).
    const first = await call(await remitosRoute.POST(json("POST", { company: "tvp", clientId: String(client._id), date: "2026-10-05", lines: [{ itemId: cemento, quantity: 5, unitPriceCents: 15_000 }, { itemId: cal, quantity: 2, unitPriceCents: 8_000 }] })));
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ kind: "salida", status: "pendiente", totalCents: 91_000 });
    expect(first.body.lines[0].ownerParts).toEqual([{ owner: "constructora", quantity: 5 }]);
    const second = await call(await remitosRoute.POST(json("POST", { company: "tvp", clientId: String(client._id), date: "2026-10-06", lines: [{ itemId: cemento, quantity: 1, unitPriceCents: 15_000 }] })));
    expect(await StockItem.findById(cemento).lean()).toMatchObject({ qty_salon: 2 });

    // La factura junta los dos remitos: el borrador ya viene con el cliente, la empresa y el neto.
    const draft = (await call(await draftRoute.GET(new Request(`http://test/api/invoices/draft?remitos=${first.body._id},${second.body._id}`)))).body;
    expect(draft).toMatchObject({ company: "tvp", clientId: String(client._id), netCents: 106_000, remitoIds: [first.body._id, second.body._id] });
    const invoice = await call(await recordsRoute.POST(json("POST", { company: "tvp", voucherType: "factura_x", clientId: String(client._id), issueDate: "2026-10-06", netCents: 106_000, vatPct: 0, status: "pendiente", remitoIds: draft.remitoIds.join(",") }), params({ entity: "invoices" })));
    expect(invoice.status).toBe(201);
    expect(await SalesRemito.findById(first.body._id).lean()).toMatchObject({ status: "facturado", invoiceIds: [new Types.ObjectId(invoice.body._id as string)] });
    // La factura no descontó stock otra vez.
    expect(await StockItem.findById(cemento).lean()).toMatchObject({ qty_salon: 2 });
    // Un remito ya facturado no se vuelve a facturar ni se anula.
    expect((await call(await recordsRoute.POST(json("POST", { company: "tvp", voucherType: "factura_x", clientId: String(client._id), issueDate: "2026-10-06", netCents: 1_00, status: "pendiente", remitoIds: first.body._id }), params({ entity: "invoices" })))).status).toBe(400);
    expect((await call(await remitoCancel.POST(json("POST", { reason: "error" }), params({ id: first.body._id })))).status).toBe(400);

    // Anular la factura devuelve los remitos a "para facturar".
    await call(await recordRoute.PATCH(json("PATCH", { status: "anulada" }), params({ entity: "invoices", id: invoice.body._id })));
    expect(await SalesRemito.findById(first.body._id).lean()).toMatchObject({ status: "pendiente", invoiceIds: [] });

    // Devolución parcial: vuelve al Salón con su dueño.
    const back = await call(await remitoReturn.POST(json("POST", { lines: [{ itemId: cemento, quantity: 2 }], note: "sobró" }), params({ id: first.body._id })));
    expect(back.status).toBe(201);
    expect(back.body).toMatchObject({ kind: "devolucion", totalCents: 30_000 });
    expect(await StockItem.findById(cemento).lean()).toMatchObject({ qty_salon: 4 });
    expect((await call(await remitoReturn.POST(json("POST", { lines: [{ itemId: cemento, quantity: 4 }] }), params({ id: first.body._id })))).status).toBe(400);

    // Un remito pendiente se anula y el material vuelve.
    const cancelled = await call(await remitoCancel.POST(json("POST", { reason: "el cliente no lo retiró" }), params({ id: second.body._id })));
    expect(cancelled.body.status).toBe("anulado");
    expect(await StockItem.findById(cemento).lean()).toMatchObject({ qty_salon: 5 });
  });

  it("una transferencia en tránsito se anula y el material vuelve al origen", async () => {
    const arena = await material("Arena m3", 6);
    const sent = await call(await transfersRoute.POST(json("POST", { from: "central", to: "salon", lines: [{ itemId: arena, quantity: 6 }] })));
    expect((await call(await transfersRoute.POST(json("POST", { from: "central", to: "salon", lines: [{ itemId: arena, quantity: 1 }] })))).status).toBe(409);
    const cancelled = await call(await transferCancel.POST(json("POST", { reason: "se rompió la camioneta" }), params({ id: sent.body._id })));
    expect(cancelled.body.status).toBe("anulada");
    expect(await StockItem.findById(arena).lean()).toMatchObject({ qty_central: 6, qty_salon: 0, transitQty: 0, quantity: 6 });
  });
});

describe("cotización aprobada: reserva, faltante y solicitud de compra", () => {
  it("consulta sin reservar, reserva al aprobar, pasa el faltante a Compras y la salida a obra consume la reserva", async () => {
    const pintura = await material("Látex interior 20 L", 3);
    const client = await Client.create({ name: "Consorcio Reserva" });
    const quote = await Quote.create({
      number: "COT-900", clientId: client._id, title: "Pintura palier", amountCents: 1_000_000_00, status: "borrador", company: "constructora",
      items: [{ name: "Pintura muros", unit: "m2", qty: 100, composition: [
        { rubro: "MAT", name: "Látex interior 20 L", unit: "balde", coefPerUnit: 0.05, unitPriceCents: 50_000_00 },
        { rubro: "MAT", name: "Rodillo lana", unit: "u", coefPerUnit: 0.02, unitPriceCents: 5_000_00 },
        { rubro: "MO", name: "Pintor", unit: "hs", coefPerUnit: 0.3, unitPriceCents: 3_000_00 },
      ] }],
    });

    // Mientras se cotiza: informa sin reservar.
    const looking = await call(await quoteStock.GET(new Request("http://test"), params({ id: String(quote._id) })));
    expect(looking.body.items.map((row: { name: string; neededQty: number; availableQty: number; shortageQty: number }) => [row.name, row.neededQty, row.availableQty, row.shortageQty]))
      .toEqual([["Látex interior 20 L", 5, 3, 2], ["Rodillo lana", 2, 0, 2]]);
    expect(await StockReservation.countDocuments({ quoteId: quote._id })).toBe(0);

    // Aprobada: reserva 3 y pide 2 de látex y los 2 rodillos.
    await call(await recordRoute.PATCH(json("PATCH", { status: "aprobada" }), params({ entity: "quotes", id: String(quote._id) })));
    expect(await StockItem.findById(pintura).lean()).toMatchObject({ reservedQty: 3 });
    const request = await Purchase.findOne({ quoteId: quote._id }).lean<Record<string, unknown>>();
    expect(request).toMatchObject({ stage: "solicitud", company: "constructora", priority: "alta" });
    expect(request!.requestLines).toEqual([
      expect.objectContaining({ name: "Látex interior 20 L", neededQty: 5, reservedQty: 3, shortageQty: 2 }),
      expect.objectContaining({ name: "Rodillo lana", neededQty: 2, reservedQty: 0, shortageQty: 2 }),
    ]);
    expect(await Notification.exists({ dedupeKey: `quote-shortage-${quote._id}` })).toBeTruthy();
    // Aprobarla de nuevo no duplica.
    await call(await recordRoute.PATCH(json("PATCH", { status: "aprobada" }), params({ entity: "quotes", id: String(quote._id) })));
    expect(await Purchase.countDocuments({ quoteId: quote._id })).toBe(1);

    // Otra cotización ya no ve esos 3 como disponibles.
    const other = await Quote.create({ number: "COT-901", clientId: client._id, title: "Otra", amountCents: 1, status: "borrador", items: [{ name: "x", qty: 1, composition: [{ rubro: "MAT", name: "Látex interior 20 L", coefPerUnit: 1 }] }] });
    const otherStock = await call(await quoteStock.GET(new Request("http://test"), params({ id: String(other._id) })));
    expect(otherStock.body.items[0]).toMatchObject({ physicalQty: 3, reservedQty: 3, availableQty: 0, shortageQty: 1 });

    // La salida a la obra de esta cotización consume la reserva.
    const work = await Work.create({ code: "OB-900", name: "Pintura palier", clientId: client._id, quoteId: quote._id, budgetCents: 1, status: "en_curso" });
    await call(await movements.POST(json("POST", { kind: "egreso", workId: String(work._id), parts: [{ warehouse: "central", quantity: 2 }] }), params({ id: pintura })));
    expect(await StockItem.findById(pintura).lean()).toMatchObject({ qty_central: 1, reservedQty: 1 });

    // Si se cae, lo que quedaba reservado se libera.
    await call(await recordRoute.PATCH(json("PATCH", { status: "rechazada" }), params({ entity: "quotes", id: String(quote._id) })));
    expect(await StockItem.findById(pintura).lean()).toMatchObject({ reservedQty: 0 });
    expect(await StockReservation.countDocuments({ quoteId: quote._id, status: "activa" })).toBe(0);
  });
});

describe("ruta de compras", () => {
  it("sigue la orden hasta el pago y marca lo que no cierra", async () => {
    const supplier = await Supplier.create({ name: "Proveedor Ruta" });
    const purchase = await Purchase.create({ number: "OC-777", company: "tvp", supplierId: supplier._id, description: "Ladrillos", amountCents: 100_000_00, stage: "orden", status: "aprobada", requestedDate: new Date(), stockedAt: new Date(), stockedWarehouse: "central" });
    const lonely = await Purchase.create({ number: "OC-778", company: "tvp", description: "Recibida sin factura", amountCents: 1_00, stage: "recepcion", status: "recibida", requestedDate: new Date(), stockedAt: new Date() });
    await Expense.create({ company: "tvp", voucherType: "factura_a", number: "0001-1", purchaseId: purchase._id, supplierId: supplier._id, description: "Ladrillos", category: "materiales", netCents: 130_000_00, amountCents: 157_300_00, issueDate: new Date() });
    await Expense.create({ company: "tvp", voucherType: "factura_c", number: "0002-9", description: "Factura suelta", category: "servicios", amountCents: 5_000_00, issueDate: new Date() });

    const route = (await call(await routeApi.GET())).body;
    const row = route.rows.find((candidate: { number: string }) => candidate.number === "OC-777");
    expect(row).toMatchObject({ step: "facturada", orderedCents: 100_000_00, invoicedCents: 157_300_00, alerts: ["Facturado más que lo ordenado"] });
    expect(route.rows.find((candidate: { _id: string }) => candidate._id === String(lonely._id)).alerts).toEqual(["Recibida sin factura"]);
    expect(route.unlinked.purchaseInvoices.map((invoice: { label: string }) => invoice.label)).toEqual(["0002-9 · Factura suelta"]);
  });
});
