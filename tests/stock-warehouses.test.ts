import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";
import { levelsOf, lowWarehouses, splitDelivery } from "../src/lib/stock-levels";
import { amountInWords } from "../src/lib/pdf-brand";

/*
 * Stock separado en Depósito Central y Salón de Ventas: el reparto de una
 * salida a obra, los pases entre depósitos con su remito, y el pase a stock
 * de una orden de compra. Base real en memoria; la sesión simulada.
 */

describe("cuentas del stock por depósito", () => {
  it("un material de antes de los depósitos tiene todo en el Central", () => {
    expect(levelsOf({ quantity: 12 })).toEqual({ central: 12, salon: 0 });
    expect(levelsOf({ quantity: 20, qty_central: 17, qty_salon: 3 })).toEqual({ central: 17, salon: 3 });
    expect(lowWarehouses({ quantity: 4, minQuantity: 5 }).map(warehouse => warehouse.key)).toEqual(["central"]);
    expect(lowWarehouses({ qty_central: 10, qty_salon: 1, min_central: 5, min_salon: 2 }).map(warehouse => warehouse.key)).toEqual(["salon"]);
  });

  it("la salida a obra sale primero del Central y lo que falta del Salón (el ejemplo de la reunión)", () => {
    expect(splitDelivery({ central: 17, salon: 5 }, 20)).toEqual({ parts: [{ warehouse: "central", quantity: 17 }, { warehouse: "salon", quantity: 3 }], missing: 0 });
    expect(splitDelivery({ central: 30, salon: 5 }, 20)).toEqual({ parts: [{ warehouse: "central", quantity: 20 }], missing: 0 });
    expect(splitDelivery({ central: 2, salon: 1 }, 5)).toEqual({ parts: [{ warehouse: "central", quantity: 2 }, { warehouse: "salon", quantity: 1 }], missing: 2 });
  });

  it("el importe en letras para el PDF", () => {
    expect(amountInWords(486_648_000)).toBe("Pesos cuatro millones ochocientos sesenta y seis mil cuatrocientos ochenta con 00/100");
    expect(amountInWords(2_100_072)).toBe("Pesos veintiún mil con 72/100");
    expect(amountInWords(3_100_000)).toBe("Pesos treinta y un mil con 00/100");
    expect(amountInWords(100_000_000)).toBe("Pesos un millón con 00/100");
  });
});

const session = { userId: new Types.ObjectId().toHexString(), name: "Encargado de depósito", email: "deposito@test.local", role: "gerencia" as const, permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session }));

const { Client, Expense, Notification, Purchase, Quote, StockItem, Work } = await import("../src/lib/models");
const movements = await import("../src/app/api/stock/[id]/movements/route");
const receive = await import("../src/app/api/purchases/[id]/receive/route");

let server: MongoMemoryServer;
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const post = (body: unknown) => new Request("http://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("stock");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("movimientos entre depósitos (API)", () => {
  it("entrada, pase al Salón, salida a obra repartida con dos remitos, y ajuste por depósito", async () => {
    const client = await Client.create({ name: "Consorcio", cuit: "30-12345678-9" });
    const quote = await Quote.create({ number: "COT-748", clientId: client._id, title: "Pintura", amountCents: 1000, status: "convertida" });
    const work = await Work.create({ code: "OB-1", name: "Fachada", clientId: client._id, quoteId: quote._id, budgetCents: 1000, status: "en_curso" });
    // Un material de antes: 10 baldes, todos en el Central.
    const item = await StockItem.create({ name: "Látex exterior", sku: "LTX20", unit: "balde", quantity: 10, avgCostCents: 100_000, valueCents: 1_000_000, min_salon: 2 });
    const id = String(item._id);
    const move = async (body: unknown) => call(await movements.POST(post(body), params({ id })));

    const entry = await move({ kind: "ingreso", warehouse: "central", quantity: 10, unitCostCents: 120_000 });
    expect(entry.status).toBe(201);
    expect(entry.body.item).toMatchObject({ qty_central: 20, qty_salon: 0, quantity: 20, avgCostCents: 110_000 });

    const transfer = await move({ kind: "transferencia", from: "central", to: "salon", quantity: 5 });
    expect(transfer.body.item).toMatchObject({ qty_central: 15, qty_salon: 5, quantity: 20, avgCostCents: 110_000 });
    expect(transfer.body.movements[0]).toMatchObject({ kind: "transferencia", warehouse: "central", toWarehouse: "salon", remito: "R-1" });

    // Pedido de 18: 15 del Central y 3 del Salón, cada uno con su remito y su gasto en la obra.
    const out = await move({ kind: "egreso", workId: String(work._id), parts: [{ warehouse: "central", quantity: 15 }, { warehouse: "salon", quantity: 3 }] });
    expect(out.status).toBe(201);
    expect(out.body.item).toMatchObject({ qty_central: 0, qty_salon: 2, quantity: 2 });
    expect(out.body.movements.map((movement: { remito: string; warehouse: string; quantity: number }) => [movement.remito, movement.warehouse, movement.quantity])).toEqual([["R-2", "central", 15], ["R-3", "salon", 3]]);
    expect(out.body.movements[0]).toMatchObject({ destinationLabel: "Obra OB-1 · Fachada", quoteNumber: "COT-748", totalCents: 1_650_000 });
    const expenses = await Expense.find({ workId: work._id }).lean() as Array<{ number: string; amountCents: number }>;
    expect(expenses.map(expense => [expense.number, expense.amountCents])).toEqual([["R-2", 1_650_000], ["R-3", 330_000]]);
    // El Salón quedó en su mínimo (2): avisa a Compras, diciendo de qué depósito.
    expect(await Notification.exists({ title: "Stock bajo en Salón de Ventas: Látex exterior" })).toBeTruthy();

    const tooMuch = await move({ kind: "egreso", workId: String(work._id), parts: [{ warehouse: "central", quantity: 1 }] });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error).toContain("Depósito Central");

    const counted = await move({ kind: "ajuste", warehouse: "salon", quantity: 4 });
    expect(counted.body.item).toMatchObject({ qty_central: 0, qty_salon: 4, quantity: 4 });
    expect(counted.body.movements[0]).toMatchObject({ kind: "ajuste", warehouse: "salon", quantity: 2 });
  });

  it("una orden de compra pasa al depósito elegido una sola vez; lo que no estaba se da de alta", async () => {
    await StockItem.create({ name: "TECHOS 5000 PU · Balde 20 KG", sku: "5000PU20", unit: "balde", quantity: 2, qty_central: 2, qty_salon: 0, avgCostCents: 190_000, valueCents: 380_000 });
    const purchase = await Purchase.create({
      number: "OC-9", description: "Pedido", amountCents: 0, requestedDate: new Date(), stage: "orden", status: "aprobada", deliverTo: "salon",
      items: [
        { code: "5000PU20", name: "TECHOS 5000 PU", presentation: "Balde 20 KG", quantity: 2, listPriceCents: 234_556_00, discountPct: 15, unitCents: 199_373_00, totalCents: 398_746_00 },
        { code: "1117C", name: "PROTEX MEMBRANA PVC", presentation: "Rollo 41 M2", minSale: "M2", quantity: 41.5, listPriceCents: 52_395_00, discountPct: 15, unitCents: 44_536_00, totalCents: 1_848_244_00 },
      ],
    });
    const id = String(purchase._id);
    const done = await call(await receive.POST(post({ warehouse: "salon" }), params({ id })));
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ number: "OC-9", warehouse: "salon", created: 1 });

    const techos = await StockItem.findOne({ sku: "5000PU20" }).lean() as Record<string, number>;
    expect(techos).toMatchObject({ qty_central: 2, qty_salon: 2, quantity: 4 });
    const membrane = await StockItem.findOne({ sku: "1117C" }).lean() as Record<string, unknown>;
    expect(membrane).toMatchObject({ name: "PROTEX MEMBRANA PVC · Rollo 41 M2", unit: "m2", qty_salon: 41.5, avgCostCents: 44_536_00 });
    expect(await Purchase.findById(id).lean()).toMatchObject({ status: "recibida", stage: "recepcion", stockedWarehouse: "salon" });

    const again = await call(await receive.POST(post({ warehouse: "central" }), params({ id })));
    expect(again.status).toBe(409);
    expect((await StockItem.findOne({ sku: "5000PU20" }).lean() as Record<string, number>).quantity).toBe(4);
    expect((await call(await receive.POST(post({ warehouse: "galpon" }), params({ id })))).status).toBe(400);
  });
});
