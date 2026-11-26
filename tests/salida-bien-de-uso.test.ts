import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";

const session = { userId: new Types.ObjectId().toHexString(), name: "Jorge", email: "compras@test.local", role: "compras" as const, permissions: defaultPermissionsForRole("compras") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { Asset, Client, Expense, StockItem, StockTicket, Work } = await import("../src/lib/models");
const cajaRoute = await import("../src/app/api/stock/caja/route");
const maintenanceRoute = await import("../src/app/api/assets/[id]/maintenance/route");

let server: MongoMemoryServer;
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const json = (body: unknown) => new Request("http://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const list = (query: string) => cajaRoute.GET(new Request(`http://test/api/stock/caja?${query}`)).then(call);

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("bien-de-uso");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

async function inGalpon(name: string, quantity: number, costCents: number) {
  const item = await StockItem.create({ name, unit: "unidad", category: "herramientas", qty_central: quantity, quantity, avgCostCents: costCents, valueCents: quantity * costCents, owners: { central: { tvp: quantity } } });
  return String(item._id);
}

describe("salida de materiales a un bien de uso", () => {
  it("baja el stock, deja el costo en el bien y no en una obra, y se ve en la ficha del bien y en el registro de salidas", async () => {
    const crique = await inGalpon("Crique hidráulico 2 t", 3, 80_000_00);
    const aceite = await inGalpon("Aceite 15W40 4 l", 10, 30_000_00);
    const truck = await Asset.create({ name: "Camioneta Hilux", identifier: "AB123CD", category: "vehiculo", status: "activo" });
    const client = await Client.create({ name: "Cliente de obra" });
    const work = await Work.create({ code: "OB-70", name: "Fachada", clientId: client._id, status: "en_curso" });
    const lines = [{ itemId: crique, quantity: 1 }, { itemId: aceite, quantity: 2 }];

    // Una salida tiene un solo destino: una obra o un bien de uso.
    expect((await call(await cajaRoute.POST(json({ kind: "egreso", lines })))).status).toBe(400);
    const both = await call(await cajaRoute.POST(json({ kind: "egreso", workId: String(work._id), assetId: String(truck._id), lines })));
    expect(both.status).toBe(400);
    expect(both.body.error).toContain("una obra o un bien de uso");

    const out = await call(await cajaRoute.POST(json({ kind: "egreso", assetId: String(truck._id), warehouse: "central", note: "Para el service", lines })));
    expect(out.status).toBe(201);
    expect(out.body).toMatchObject({ kind: "egreso", assetId: String(truck._id), destinationLabel: "Bien de uso: Camioneta Hilux (AB123CD)", totalCents: 80_000_00 + 2 * 30_000_00 });
    expect(out.body.workId).toBeUndefined();
    expect(out.body.remitos).toHaveLength(1);
    // Bajó el stock y el movimiento quedó atado al bien, sin gasto de obra.
    const item = await StockItem.findById(aceite).lean<{ qty_central: number; movements: Array<Record<string, unknown>> }>();
    expect(item!.qty_central).toBe(8);
    expect(item!.movements.at(-1)).toMatchObject({ kind: "egreso", quantity: 2, destinationLabel: "Bien de uso: Camioneta Hilux (AB123CD)", totalCents: 60_000_00, ticket: out.body.number });
    expect(String(item!.movements.at(-1)!.assetId)).toBe(String(truck._id));
    expect(item!.movements.at(-1)!.expenseId).toBeUndefined();
    expect(await Expense.countDocuments({})).toBe(0);

    // La salida a obra sigue igual: carga el costo en la obra.
    const toWork = await call(await cajaRoute.POST(json({ kind: "egreso", workId: String(work._id), lines: [{ itemId: aceite, quantity: 1 }] })));
    expect(toWork.status).toBe(201);
    expect(toWork.body.assetId).toBeUndefined();
    expect(await Expense.countDocuments({ workId: work._id })).toBe(1);

    // La ficha del bien y el registro de salidas filtran por destino.
    expect((await list(`kind=egreso&assetId=${String(truck._id)}`)).body.items.map((row: { number: string }) => row.number)).toEqual([out.body.number]);
    expect((await list("kind=egreso&destino=bien&limit=50")).body.items.map((row: { number: string }) => row.number)).toEqual([out.body.number]);
    expect((await list("kind=egreso&destino=obra&limit=50")).body.items.map((row: { number: string }) => row.number)).toEqual([toWork.body.number]);

    // El service de la camioneta queda atado a los materiales que se usaron.
    const service = await call(await maintenanceRoute.POST(json({ action: "service", date: "2026-11-26", kind: "service", description: "Cambio de aceite", costCents: 0, tickets: [out.body.number] }), params({ id: String(truck._id) })));
    expect(service.status).toBeLessThan(300);
    expect((await Asset.findById(truck._id).lean<{ maintenance: Array<{ tickets?: string[] }> }>())!.maintenance[0].tickets).toEqual([out.body.number]);

    // A un bien dado de baja no sale nada.
    await Asset.updateOne({ _id: truck._id }, { $set: { status: "baja" } });
    const refused = await call(await cajaRoute.POST(json({ kind: "egreso", assetId: String(truck._id), lines: [{ itemId: crique, quantity: 1 }] })));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("dado de baja");
    expect(await StockTicket.countDocuments({ assetId: truck._id })).toBe(1);
  });
});
