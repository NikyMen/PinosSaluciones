import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { BitArray, Code128Reader } from "@zxing/library";
import { defaultPermissionsForRole } from "../src/lib/permissions";
import { code128Widths, CODE128_PATTERNS, internalBarcode } from "../src/lib/barcode";
import { addMonthsIso, nextPlan, planState } from "../src/lib/assets";

/*
 * La caja del depósito (varios materiales escaneados que entran o salen de una
 * vez, con un solo comprobante y un remito por depósito), los códigos de barras
 * de las etiquetas, y el mantenimiento programado de los bienes de uso.
 */

/** Lo que "ve" un lector: el código dibujado como una fila de módulos negros y blancos. */
function decode(text: string) {
  const widths = [10, ...code128Widths(text), 10];
  const size = widths.reduce((total, width) => total + width, 0);
  const row = new BitArray(size);
  let x = 0;
  widths.forEach((width, index) => {
    // Los márgenes (primero y último) son blancos; adentro, alternan barra y espacio.
    const black = index > 0 && index < widths.length - 1 && (index - 1) % 2 === 0;
    if (black) for (let i = 0; i < width; i++) row.set(x + i);
    x += width;
  });
  return new Code128Reader().decodeRow(0, row, new Map()).getText();
}

describe("códigos de barras de las etiquetas", () => {
  it("cada símbolo mide 11 módulos (la parada, 13)", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.forEach((pattern, index) => expect([...pattern].reduce((total, width) => total + Number(width), 0)).toBe(index === 106 ? 13 : 11));
  });

  it("lo que se imprime lo lee un lector de verdad", () => {
    for (const text of ["PS-000123", "7791234567890", "CJ-12", "Latex 20L", "a b/c.d"]) expect(decode(text)).toBe(text);
    expect(internalBarcode(42)).toBe("PS-000042");
    expect(() => code128Widths("Ñandú")).toThrow();
  });
});

describe("cuándo toca un mantenimiento", () => {
  it("dentro de N meses, sin pasarse de fin de mes", () => {
    expect(addMonthsIso("2026-09-29", 3)).toBe("2026-12-29");
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("vencido, se acerca o al día; por fecha o por uso, lo primero que llegue", () => {
    const now = new Date("2026-09-29T15:00:00Z");
    expect(planState({ title: "Service", dueDate: "2026-12-29" }, {}, now)).toMatchObject({ state: "al_dia", daysLeft: 91 });
    expect(planState({ title: "Service", dueDate: "2026-10-10" }, {}, now)).toMatchObject({ state: "proximo", daysLeft: 11 });
    expect(planState({ title: "Service", dueDate: "2026-09-20" }, {}, now)).toMatchObject({ state: "vencido", daysLeft: -9 });
    // A los 60.000 km, cada 10.000: avisa cuando faltan 1.000.
    expect(planState({ title: "Service", dueReading: 60_000, intervalReading: 10_000 }, { meterUnit: "km", currentReading: 58_000 }, now).state).toBe("al_dia");
    expect(planState({ title: "Service", dueReading: 60_000, intervalReading: 10_000 }, { meterUnit: "km", currentReading: 59_200 }, now).state).toBe("proximo");
    expect(planState({ title: "Service", dueDate: "2027-03-01", dueReading: 60_000 }, { meterUnit: "km", currentReading: 60_500 }, now)).toMatchObject({ state: "vencido", readingLeft: -500 });
    expect(nextPlan([{ title: "B", dueReading: 10 }, { title: "A", dueDate: "2027-01-01" }, { title: "C", dueDate: "2026-12-01", status: "hecho" }])?.title).toBe("A");
  });
});

const session = { userId: new Types.ObjectId().toHexString(), name: "Encargado de depósito", email: "deposito@test.local", role: "gerencia" as const, permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session }));

const { Asset, Client, Expense, Notification, Purchase, Quote, StockItem, StockTicket, Task, Work } = await import("../src/lib/models");
const caja = await import("../src/app/api/stock/caja/route");
const scan = await import("../src/app/api/stock/scan/route");
const records = await import("../src/app/api/records/[entity]/route");
const maintenance = await import("../src/app/api/assets/[id]/maintenance/route");

let server: MongoMemoryServer;
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const post = (body: unknown) => new Request("http://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("counter");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("caja del depósito (API)", () => {
  it("el lector encuentra el material por código de barras o por código interno; un código es de un solo material", async () => {
    await StockItem.create({ name: "Cemento 50 kg", sku: "CEM50", barcode: "7790001112223", unit: "bolsa" });
    const sand = await StockItem.create({ name: "Arena fina", unit: "m3" });

    const byBarcode = await call(await scan.GET(new Request("http://test?code=7790001112223%0D")));
    expect(byBarcode.status).toBe(200);
    expect(byBarcode.body.item).toMatchObject({ name: "Cemento 50 kg" });
    expect((await call(await scan.GET(new Request("http://test?code=cem50")))).body.item.name).toBe("Cemento 50 kg");
    const missing = await call(await scan.GET(new Request("http://test?code=123456")));
    expect(missing).toMatchObject({ status: 404, body: { code: "123456" } });

    // El código que no estaba se le asigna a la arena; el del cemento no se puede repetir.
    expect((await call(await scan.POST(post({ itemId: String(sand._id), code: "123456" })))).status).toBe(200);
    expect((await call(await scan.GET(new Request("http://test?code=123456")))).body.item.name).toBe("Arena fina");
    const taken = await call(await scan.POST(post({ itemId: String(sand._id), code: "7790001112223" })));
    expect(taken.status).toBe(409);
    expect(taken.body.error).toContain("Cemento 50 kg");

    // Sin código propio, se le genera uno para la etiqueta; la segunda vez devuelve el mismo.
    const bucket = await StockItem.create({ name: "Balde albañil", unit: "unidad" });
    const first = await call(await scan.POST(post({ itemId: String(bucket._id), generate: true })));
    expect(first.body.barcode).toMatch(/^PS-\d{6}$/);
    expect((await call(await scan.POST(post({ itemId: String(bucket._id), generate: true })))).body.barcode).toBe(first.body.barcode);
  });

  it("una entrada de varios materiales: una sola orden recibida y un comprobante; una salida: un remito por depósito para todos", async () => {
    const client = await Client.create({ name: "Consorcio Norte", cuit: "30-22345678-9" });
    const quote = await Quote.create({ number: "COT-900", clientId: client._id, title: "Hall", amountCents: 1000, status: "convertida" });
    const work = await Work.create({ code: "OB-9", name: "Hall central", clientId: client._id, quoteId: quote._id, budgetCents: 1000, status: "en_curso" });
    const paint = await StockItem.create({ name: "Látex interior", barcode: "LTX-1", unit: "balde", qty_central: 2, qty_salon: 3, quantity: 5, avgCostCents: 100_000, valueCents: 500_000 });
    const roller = await StockItem.create({ name: "Rodillo", barcode: "ROD-1", unit: "unidad" });

    const entry = await call(await caja.POST(post({
      kind: "ingreso", warehouse: "central", reference: "0001-00001234",
      lines: [{ itemId: String(paint._id), quantity: 3, unitCostCents: 120_000 }, { itemId: String(roller._id), quantity: 10, unitCostCents: 5_000 }, { itemId: String(roller._id), quantity: 2, unitCostCents: 5_000 }],
    })));
    expect(entry.status).toBe(201);
    expect(entry.body).toMatchObject({ kind: "ingreso", totalCents: 420_000 });
    expect(entry.body.number).toMatch(/^CJ-\d+$/);
    // El rodillo escaneado dos veces es un solo renglón.
    expect(entry.body.lines.map((line: { name: string; quantity: number }) => [line.name, line.quantity])).toEqual([["Látex interior", 3], ["Rodillo", 12]]);
    const purchases = await Purchase.find({ number: entry.body.number }).lean() as Array<{ items: unknown[]; status: string; stockedAt?: Date }>;
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({ status: "recibida" });
    expect(purchases[0].items).toHaveLength(2);
    expect(await StockItem.findById(paint._id).lean()).toMatchObject({ qty_central: 5, qty_salon: 3, quantity: 8, avgCostCents: 107_500 });

    // Salen 7 baldes y 4 rodillos: los baldes 5 del Central y 2 del Salón; los rodillos, del Central. Dos remitos, no tres.
    const out = await call(await caja.POST(post({ kind: "egreso", workId: String(work._id), note: "Retira Juan", lines: [{ itemId: String(paint._id), quantity: 7 }, { itemId: String(roller._id), quantity: 4 }] })));
    expect(out.status).toBe(201);
    expect(out.body).toMatchObject({ kind: "egreso", destinationLabel: "Obra OB-9 · Hall central", quoteNumber: "COT-900" });
    expect(out.body.remitos.map((remito: { warehouse: string }) => remito.warehouse)).toEqual(["central", "salon"]);
    const [central, salon] = out.body.remitos.map((remito: { number: string }) => remito.number);
    expect(out.body.lines[0].parts).toEqual([{ warehouse: "central", quantity: 5, remito: central }, { warehouse: "salon", quantity: 2, remito: salon }]);
    expect(out.body.lines[1].parts).toEqual([{ warehouse: "central", quantity: 4, remito: central }]);
    expect(await StockItem.findById(paint._id).lean()).toMatchObject({ qty_central: 0, qty_salon: 1, quantity: 1 });
    const saved = await StockItem.findById(roller._id).lean() as { movements: Array<{ ticket?: string; remito?: string }> };
    expect(saved.movements.at(-1)).toMatchObject({ ticket: out.body.number, remito: central });
    expect(await Expense.countDocuments({ workId: work._id })).toBe(3);

    // Si uno no alcanza, no se mueve ninguno.
    const short = await call(await caja.POST(post({ kind: "egreso", workId: String(work._id), lines: [{ itemId: String(roller._id), quantity: 1 }, { itemId: String(paint._id), quantity: 2 }] })));
    expect(short.status).toBe(409);
    expect(short.body.error).toContain("Látex interior");
    expect((await StockItem.findById(roller._id).lean() as { quantity: number }).quantity).toBe(8);
    // Del Salón, a propósito: hay 1.
    expect((await call(await caja.POST(post({ kind: "egreso", workId: String(work._id), warehouse: "salon", lines: [{ itemId: String(paint._id), quantity: 1 }] })))).status).toBe(201);

    const recent = await call(await caja.GET(new Request("http://test?limit=5")));
    expect(recent.body.items.map((ticket: { kind: string }) => ticket.kind)).toEqual(["egreso", "egreso", "ingreso"]);
    expect(await StockTicket.countDocuments()).toBe(3);
  });
});

describe("bienes de uso: mantenimiento programado (API)", () => {
  it("se registra el service y se programa el próximo; por km avisa al cargar la lectura; hecho, deja de avisar", async () => {
    const created = await call(await records.POST(post({ name: "Camioneta Hilux", category: "vehiculo", identifier: "AB 123 CD", status: "activo", meterUnit: "km", currentReading: 50_000, valueCents: 0 }), params({ entity: "assets" })));
    expect(created.status).toBe(201);
    const id = String(created.body._id);
    const act = async (body: unknown) => call(await maintenance.POST(post(body), params({ id })));

    // Se le hizo el service: el próximo, dentro de 3 meses o a los 60.000 km.
    const service = await act({ action: "service", date: "2026-09-29", kind: "service", description: "Service 50.000 km", costCents: 35_000_000, reading: 50_200, provider: "Taller Pérez", createExpense: true,
      next: { title: "Service 60.000 km", dueDate: "2026-12-29", dueReading: 60_000, intervalMonths: 3, intervalReading: 10_000 } });
    expect(service.status).toBe(201);
    expect(service.body.asset).toMatchObject({ currentReading: 50_200, nextDueTitle: "Service 60.000 km" });
    expect(new Date(service.body.asset.nextDueDate).toISOString().slice(0, 10)).toBe("2026-12-29");
    expect(await Expense.findById(service.body.expenseId).lean()).toMatchObject({ category: "servicios", amountCents: 35_000_000 });
    const plan = service.body.asset.plans[0];

    // Todavía faltan muchos km: nada. A los 59.300 ya se acerca: aviso y tarea a Compras.
    await act({ action: "reading", reading: 55_000 });
    expect(await Task.countDocuments({ relatedType: "asset_plans" })).toBe(0);
    await act({ action: "reading", reading: 59_300 });
    const task = await Task.findOne({ relatedType: "asset_plans", relatedId: plan._id }).lean() as { title: string; assigneeRole: string; status: string };
    expect(task).toMatchObject({ assigneeRole: "compras", status: "pendiente" });
    expect(task.title).toContain("Camioneta Hilux (AB 123 CD)");
    expect(await Notification.exists({ dedupeKey: `asset-plan-${plan._id}` })).toBeTruthy();

    // Se hizo lo programado: queda hecho, la tarea se completa y el aviso se cierra.
    const done = await act({ action: "service", date: "2026-10-05", kind: "preventivo", description: "Service 60.000 km", costCents: 0, reading: 59_900, planId: plan._id });
    expect(done.body.asset.plans[0]).toMatchObject({ status: "hecho" });
    expect(done.body.asset.nextDueDate).toBeUndefined();
    expect((await Task.findOne({ relatedId: plan._id }).lean() as { status: string }).status).toBe("completada");
    expect((await Notification.findOne({ dedupeKey: `asset-plan-${plan._id}` }).lean() as { status: string }).status).toBe("hecha");

    // Programar sin fecha ni km no tiene sentido; por km en algo que no se mide, tampoco.
    expect((await act({ action: "plan", title: "Revisar" })).status).toBe(409);
    const tool = await Asset.create({ name: "Hidrolavadora", category: "maquinaria", meterUnit: "ninguno" });
    expect((await call(await maintenance.POST(post({ action: "plan", title: "Cambio de aceite", dueReading: 100 }), params({ id: String(tool._id) })))).status).toBe(409);
    const scheduled = await call(await maintenance.POST(post({ action: "plan", title: "Cambio de aceite", dueDate: "2027-01-15" }), params({ id: String(tool._id) })));
    expect(scheduled.body.asset.nextDueTitle).toBe("Cambio de aceite");
    const cancelled = await call(await maintenance.POST(post({ action: "cancel_plan", planId: scheduled.body.asset.plans[0]._id }), params({ id: String(tool._id) })));
    expect(cancelled.body.asset.plans[0].status).toBe("cancelado");
    expect(cancelled.body.asset.nextDueTitle).toBeUndefined();

    // El listado no arrastra el historial.
    const list = await call(await records.GET(new Request("http://test?limit=10"), params({ entity: "assets" })));
    expect(list.body.items.find((row: { _id: string }) => row._id === id)).not.toHaveProperty("maintenance");
  });
});
