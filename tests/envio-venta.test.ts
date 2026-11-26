import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";

const session = { userId: new Types.ObjectId().toHexString(), name: "Ventas", email: "ventas@test.local", role: "gerencia" as const, permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { Client, Shipment, StockItem } = await import("../src/lib/models");
const remitosRoute = await import("../src/app/api/remitos/route");
const remitoCancel = await import("../src/app/api/remitos/[id]/cancel/route");
const remitoShipment = await import("../src/app/api/remitos/[id]/shipment/route");
const shipmentTracking = await import("../src/app/api/shipments/[id]/tracking/route");
const shipmentCancel = await import("../src/app/api/shipments/[id]/cancel/route");
const threadRoute = await import("../src/app/api/thread/[kind]/[id]/route");

let server: MongoMemoryServer;
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const json = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("envio-venta");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

async function inSalon(name: string, quantity: number) {
  const item = await StockItem.create({ name, sku: name.slice(0, 3).toUpperCase(), unit: "unidad", category: "materiales", qty_salon: quantity, quantity, avgCostCents: 4_000, valueCents: quantity * 4_000, owners: { salon: { tvp: quantity } } });
  return String(item._id);
}

describe("envío por transporte de un remito de venta", () => {
  it("hace el ENV con el valor declarado del remito sin volver a bajar el stock, y se ve en el remito y en su historial", async () => {
    const rodillo = await inSalon("Rodillo 22 cm", 10);
    const lija = await inSalon("Lija al agua", 50);
    const client = await Client.create({ name: "Pinturería del Sur", cuit: "30-55555555-5", address: "San Martín 450, Rosario" });
    const remito = await call(await remitosRoute.POST(json("POST", { company: "tvp", clientId: String(client._id), date: "2026-11-20", lines: [{ itemId: rodillo, quantity: 4, unitPriceCents: 9_000 }, { itemId: lija, quantity: 10, unitPriceCents: 500, discountCents: 1_000 }] })));
    expect(remito.status).toBe(201);
    expect(await StockItem.findById(rodillo).lean()).toMatchObject({ qty_salon: 6 });

    // Sin transporte no sale.
    expect((await call(await remitoShipment.POST(json("POST", { destination: "San Martín 450, Rosario", carrier: "" }), params({ id: remito.body._id })))).status).toBe(400);

    const sent = await call(await remitoShipment.POST(json("POST", { destination: "San Martín 450, Rosario", receiver: "Pinturería del Sur", carrier: "Correo Argentino", packages: 2 }), params({ id: remito.body._id })));
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ status: "despachado", carrier: "Correo Argentino", salesRemitoNumber: remito.body.number, company: "tvp", from: "salon" });
    expect(sent.body.number).toMatch(/^ENV-\d+$/);
    // El valor declarado es el neto del remito: 4 × 9.000 + (10 × 500 − 1.000).
    expect(sent.body.declaredCents).toBe(40_000);
    expect(sent.body.lines.map((line: { name: string; quantity: number; declaredUnitCents: number }) => [line.name, line.quantity, line.declaredUnitCents])).toEqual([["Rodillo 22 cm", 4, 9_000], ["Lija al agua", 10, 400]]);
    // No volvió a bajar el stock.
    expect(await StockItem.findById(rodillo).lean()).toMatchObject({ qty_salon: 6, quantity: 6 });
    expect(await StockItem.findById(lija).lean()).toMatchObject({ qty_salon: 40 });

    // Un remito tiene un solo envío vigente, y con envío no se anula.
    const again = await call(await remitoShipment.POST(json("POST", { destination: "Rosario", carrier: "Mercado Libre" }), params({ id: remito.body._id })));
    expect(again.status).toBe(409);
    expect(again.body.error).toContain(sent.body.number);
    const blocked = await call(await remitoCancel.POST(json("POST", { reason: "error de carga" }), params({ id: remito.body._id })));
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toContain("envío");

    // La lista de remitos muestra el envío.
    const list = (await call(await remitosRoute.GET(new Request("http://test/api/remitos")))).body.items as Array<{ _id: string; shipment?: { number: string } | null }>;
    expect(list.find(row => row._id === remito.body._id)!.shipment).toMatchObject({ number: sent.body.number, status: "despachado" });

    // El historial del remito trae el envío, en Ventas.
    const thread = (await call(await threadRoute.GET(new Request("http://test"), { params: Promise.resolve({ kind: "sales_remito", id: remito.body._id }) }))).body;
    expect(thread.nodes.find((node: { kind: string }) => node.kind === "shipment")).toMatchObject({ group: "ventas", type: "Envío por transporte", number: sent.body.number, status: "Despachado" });

    // Anular el envío no devuelve stock: lo que salió, salió con el remito.
    const cancelled = await call(await shipmentCancel.POST(json("POST", { reason: "el cliente lo retira" }), params({ id: sent.body._id })));
    expect(cancelled.body.status).toBe("anulado");
    expect(await StockItem.findById(rodillo).lean()).toMatchObject({ qty_salon: 6 });

    // Con el envío anulado se puede hacer otro, con otro valor declarado, y cargarle la guía.
    const second = await call(await remitoShipment.POST(json("POST", { destination: "Sucursal Rosario Centro", carrier: "Mercado Libre (Mercado Envíos)", lines: [{ itemId: rodillo, declaredUnitCents: 10_000 }] }), params({ id: remito.body._id })));
    expect(second.status).toBe(201);
    expect(second.body.declaredCents).toBe(44_000);
    const guide = await call(await shipmentTracking.POST(json("POST", { trackingNumber: "ML-778899" }), params({ id: second.body._id })));
    expect(guide.body).toMatchObject({ status: "con_guia", trackingNumber: "ML-778899" });
    expect(await Shipment.countDocuments({ salesRemitoId: remito.body._id })).toBe(2);
  });

  it("no envía un remito anulado ni una devolución", async () => {
    const pincel = await inSalon("Pincel N° 20", 5);
    const client = await Client.create({ name: "Consumidor de paso" });
    const remito = await call(await remitosRoute.POST(json("POST", { company: "tvp", clientId: String(client._id), date: "2026-11-21", lines: [{ itemId: pincel, quantity: 1, unitPriceCents: 2_000 }] })));
    await call(await remitoCancel.POST(json("POST", { reason: "se arrepintió" }), params({ id: remito.body._id })));
    const sent = await call(await remitoShipment.POST(json("POST", { destination: "Resistencia", carrier: "Correo Argentino" }), params({ id: remito.body._id })));
    expect(sent.status).toBe(409);
    expect(sent.body.error).toContain("anulado");
  });
});

describe("nota de crédito de una devolución", () => {
  it("el borrador trae la factura del remito, el cliente y lo devuelto ya cargado", async () => {
    const recordsRoute = await import("../src/app/api/records/[entity]/route");
    const remitoReturn = await import("../src/app/api/remitos/[id]/return/route");
    const draftRoute = await import("../src/app/api/invoices/draft/route");
    const latex = await inSalon("Látex interior 20 l", 8);
    const client = await Client.create({ name: "Estudio Litoral", cuit: "30-66666666-6" });
    const remito = await call(await remitosRoute.POST(json("POST", { company: "tvp", clientId: String(client._id), date: "2026-11-18", lines: [{ itemId: latex, quantity: 4, unitPriceCents: 50_000 }] })));
    const invoice = await call(await recordsRoute.POST(json("POST", { company: "tvp", voucherType: "factura_a", number: "0004-00000700", clientId: String(client._id), issueDate: "2026-11-18", netCents: 200_000, vatPct: 21, status: "pendiente", remitoIds: remito.body._id }), params({ entity: "invoices" })));
    expect(invoice.status).toBe(201);
    const back = await call(await remitoReturn.POST(json("POST", { lines: [{ itemId: latex, quantity: 1 }], note: "tacho abollado", date: "2026-11-19" }), params({ id: remito.body._id })));
    expect(back.status).toBe(201);

    const draft = (await call(await draftRoute.GET(new Request(`http://test/api/invoices/draft?devolucion=${back.body._id}`)))).body;
    expect(draft).toMatchObject({
      company: "tvp", voucherType: "nota_credito_a", clientId: String(client._id), associatedInvoiceId: invoice.body._id, withRemito: false, netCents: 50_000,
      lines: [{ description: "Látex interior 20 l", quantity: 1, unitCents: 50_000 }],
    });
    expect(draft.description).toContain(back.body.number);
  });
});
