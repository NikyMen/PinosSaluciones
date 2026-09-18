import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";

/*
 * El circuito completo de inspecciones contra una base real en memoria, usando
 * las rutas de la API tal cual. Lo único simulado es la sesión.
 */
const session = { userId: new Types.ObjectId().toHexString(), name: "Gerente de prueba", email: "gerencia@test.local", role: "gerencia" as const, permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session }));

const { Client, Notification, StockItem, Work, WorkInspection } = await import("../src/lib/models");
const inspections = await import("../src/app/api/works/[id]/inspections/route");
const inspection = await import("../src/app/api/works/[id]/inspections/[inspectionId]/route");
const closeRoute = await import("../src/app/api/works/[id]/inspections/[inspectionId]/close/route");
const progressBase = await import("../src/app/api/works/[id]/progress-base/route");

let server: MongoMemoryServer;
const day = "2026-09-18";
const nextDay = "2026-09-19";

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

async function createWork(extra: Record<string, unknown> = {}) {
  const client = await Client.create({ name: "Consorcio de prueba", cuit: "30-12345678-9", address: "9 de Julio 1699" });
  const workerId = new Types.ObjectId();
  const helperId = new Types.ObjectId();
  return Work.create({
    code: `OB-${new Types.ObjectId().toHexString().slice(-6)}`, name: "Edificio de prueba", clientId: client._id, budgetCents: 40_000_000, status: "en_curso",
    assignedWorkers: [{ workerId, name: "Pérez, Juan", category: "oficial" }, { workerId: helperId, name: "Gómez, Ana", category: "ayudante" }],
    labor: [
      { workerId, person: "Pérez, Juan", date: new Date(`${day}T00:00:00.000Z`), hours: 8 },
      { workerId: helperId, person: "Gómez, Ana", date: new Date(`${day}T00:00:00.000Z`), hours: 6 },
    ],
    ...extra,
  });
}

async function fullDraft(workId: string, inspectionId: string, todayQty: number, overrides: Record<string, unknown> = {}) {
  const current = await call(await inspection.GET(new Request("http://test"), params({ id: workId, inspectionId })));
  const draft = current.body.inspection;
  return call(await inspection.PATCH(new Request("http://test", { ...json({
    managerName: "Capataz Ruiz", weather: "seco", performance: "normal",
    production: draft.production.map((row: { lineId?: string }) => ({ lineId: row.lineId || "", todayQty })),
    quality: draft.quality.map((point: { key: string; label: string }) => ({ ...point, result: "cumple", notes: "" })),
    safety: draft.safety.map((point: { key: string; label: string }) => ({ ...point, result: "cumple", notes: "" })),
    ...overrides,
  }), method: "PATCH" }), params({ id: workId, inspectionId })));
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("inspecciones");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
  await WorkInspection.init();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("inspecciones de obra (API)", () => {
  it("recorre el circuito: base, borrador, cierre, avance, historial y alertas", async () => {
    const work = await createWork();
    const workId = String(work._id);
    await StockItem.create({ name: "Látex exterior", unit: "balde", quantity: 10, movements: [{ kind: "egreso", quantity: 4, workId: work._id, date: new Date(`${day}T00:00:00.000Z`) }] });

    // Base: pintura 100 m² por $300.000 y albañilería 10 m² por $100.000.
    const base = await call(await progressBase.PUT(new Request("http://test", { ...json({ lines: [
      { rubro: "pintura", label: "Pintura de fachada", unit: "m2", plannedQty: 100, amountCents: 30_000_000 },
      { rubro: "albanileria", label: "Muros", unit: "m2", plannedQty: 10, amountCents: 10_000_000 },
    ] }), method: "PUT" }), params({ id: workId })));
    expect(base.status).toBe(200);
    expect(base.body.progress.mode).toBe("inspecciones");
    expect(base.body.progress.progress).toBe(0);

    // Alta: llega con la plantilla de pintura, el personal de los partes y lo que entregó Stock.
    const created = await call(await inspections.POST(new Request("http://test", json({ date: day, rubro: "pintura" })), params({ id: workId })));
    expect(created.status).toBe(201);
    const inspectionId = String(created.body._id);
    expect(created.body.quality).toHaveLength(5);
    expect(created.body.safety).toHaveLength(4);
    expect(created.body.staff).toMatchObject({ source: "partes", oficiales: 1, ayudantes: 1, hoursWorked: 14 });
    expect(created.body.materialsReceived).toEqual([expect.objectContaining({ source: "stock", name: "Látex exterior", quantity: 4 })]);
    expect(created.body.production).toHaveLength(1);

    // Una sola por obra, rubro y día.
    const duplicate = await call(await inspections.POST(new Request("http://test", json({ date: day, rubro: "pintura" })), params({ id: workId })));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.existingId).toBe(inspectionId);

    // Sin completar no se cierra, y el servidor dice qué falta.
    const early = await call(await closeRoute.POST(new Request("http://test", { method: "POST" }), params({ id: workId, inspectionId })));
    expect(early.status).toBe(400);
    expect(early.body.problems.join(" ")).toMatch(/clima/);

    const saved = await fullDraft(workId, inspectionId, 50, {
      quality: created.body.quality.map((point: { key: string; label: string }, index: number) => ({ ...point, result: index === 0 ? "no_cumple" : "cumple", notes: index === 0 ? "Marcas en el enduido" : "" })),
      shortages: [{ material: "Rodillos", quantity: 6, unit: "u" }], shortageNeededBy: nextDay, shortageOrderStatus: "pedido_pendiente",
      // 10 baldes de 20 (50%) para el 50% de la pintura: consumo acorde.
      mainMaterial: { name: "Látex exterior", unit: "balde", plannedQty: 20, stockStart: 7, receivedToday: 4, stockEnd: 1 },
    });
    expect(saved.status).toBe(200);

    const closed = await call(await closeRoute.POST(new Request("http://test", { method: "POST" }), params({ id: workId, inspectionId })));
    expect(closed.status).toBe(200);
    expect(closed.body.inspection.status).toBe("cerrada");
    expect(closed.body.inspection.production[0]).toMatchObject({ previousQty: 0, todayQty: 50, accumulatedQty: 50, progressPct: 50 });
    expect(closed.body.inspection.mainMaterial).toMatchObject({ consumptionToday: 10, consumptionAccumulated: 10, remaining: 10, deviation: "acorde", enough: true });
    expect(closed.body.inspection.alerts.map((alert: { kind: string }) => alert.kind)).toEqual(["calidad", "materiales"]);
    // Pintura 50% con $300.000 y albañilería 0% con $100.000 = 37,5%.
    expect(closed.body.progress).toMatchObject({ mode: "inspecciones", progress: 37.5 });

    const updated = await Work.findById(workId).lean() as unknown as { progress: number; progressMode: string; activity: Array<{ detail: string }> };
    expect(updated.progress).toBe(37.5);
    expect(updated.progressMode).toBe("inspecciones");
    expect(updated.activity.at(-1)?.detail).toMatch(/Inspección de pintura del 18\/09\/2026 cerrada/);

    const notices = await Notification.find({ href: `/app/works/${workId}/inspections/${inspectionId}` }).lean() as unknown as Array<{ roles: string[] }>;
    expect(notices.map(notice => notice.roles.sort().join(","))).toEqual(expect.arrayContaining(["arquitecto,gerencia", "compras,gerencia"]));

    // Cerrada ya no se edita ni se descarta.
    expect((await inspection.PATCH(new Request("http://test", { ...json({ stage: "Otra" }), method: "PATCH" }), params({ id: workId, inspectionId }))).status).toBe(409);
    expect((await inspection.DELETE(new Request("http://test", { method: "DELETE" }), params({ id: workId, inspectionId }))).status).toBe(409);

    // Al día siguiente se arranca con lo acumulado y el stock que quedó.
    const second = await call(await inspections.POST(new Request("http://test", json({ date: nextDay, rubro: "pintura" })), params({ id: workId })));
    expect(second.body.mainMaterial).toMatchObject({ name: "Látex exterior", stockStart: 1, plannedQty: 20 });
    const secondId = String(second.body._id);
    const context = await call(await inspection.GET(new Request("http://test"), params({ id: workId, inspectionId: secondId })));
    expect(Object.values(context.body.context.previousByLine)).toContain(50);
    await fullDraft(workId, secondId, 30);
    const secondClosed = await call(await closeRoute.POST(new Request("http://test", { method: "POST" }), params({ id: workId, inspectionId: secondId })));
    expect(secondClosed.body.inspection.production[0]).toMatchObject({ previousQty: 50, accumulatedQty: 80, progressPct: 80 });
    expect(secondClosed.body.progress.progress).toBe(60);

    // Una línea con producción informada no se puede quitar de la base.
    const lines = (await Work.findById(workId).lean() as unknown as { progressBase: Array<{ _id: Types.ObjectId; rubro: string; label: string; unit: string; plannedQty: number; amountCents: number }> }).progressBase;
    const removal = await call(await progressBase.PUT(new Request("http://test", { ...json({ lines: lines.filter(line => line.rubro !== "pintura").map(line => ({ ...line, _id: String(line._id) })) }), method: "PUT" }), params({ id: workId })));
    expect(removal.status).toBe(409);

    const history = await call(await inspections.GET(new Request("http://test"), params({ id: workId })));
    expect(history.body.items).toHaveLength(2);
    expect(history.body.progress.byRubro).toMatchObject({ pintura: 80, albanileria: 0 });
  }, 60_000);

  it("sin base de avance registra la producción pero no inventa un porcentaje", async () => {
    const work = await createWork();
    const workId = String(work._id);
    const created = await call(await inspections.POST(new Request("http://test", json({ date: day, rubro: "albanileria" })), params({ id: workId })));
    const inspectionId = String(created.body._id);
    expect(created.body.production).toEqual([expect.objectContaining({ label: "Albañilería", plannedQty: 0 })]);
    await fullDraft(workId, inspectionId, 12);
    const closed = await call(await closeRoute.POST(new Request("http://test", { method: "POST" }), params({ id: workId, inspectionId })));
    expect(closed.status).toBe(200);
    expect(closed.body.progress).toMatchObject({ mode: "sin_base", progress: 0, overall: null });
    expect(closed.body.inspection.production[0].todayQty).toBe(12);
  }, 60_000);

  it("una obra con avance manual lo conserva hasta que se le carga la base, y lo ya ejecutado no vuelve a cero", async () => {
    const work = await createWork({ progress: 40, progressMode: "manual", advances: [{ percentage: 40, note: "Avance anterior", date: new Date() }] });
    const workId = String(work._id);
    const created = await call(await inspections.POST(new Request("http://test", json({ date: day, rubro: "pintura" })), params({ id: workId })));
    await fullDraft(workId, String(created.body._id), 5);
    const closed = await call(await closeRoute.POST(new Request("http://test", { method: "POST" }), params({ id: workId, inspectionId: String(created.body._id) })));
    expect(closed.body.progress).toMatchObject({ mode: "manual", progress: 40 });

    const base = await call(await progressBase.PUT(new Request("http://test", { ...json({ lines: [{ rubro: "pintura", label: "Pintura", unit: "m2", plannedQty: 100, initialQty: 40, amountCents: 1 }] }), method: "PUT" }), params({ id: workId })));
    expect(base.body.progress).toMatchObject({ mode: "inspecciones", progress: 40 });
  }, 60_000);
});
