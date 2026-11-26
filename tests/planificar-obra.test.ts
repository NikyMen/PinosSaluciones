import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";

// Producción planifica con el permiso de Obras: no tiene el de Cotizaciones.
const session = { userId: new Types.ObjectId().toHexString(), name: "Fede", email: "obras@test.local", role: "arquitecto" as const, permissions: defaultPermissionsForRole("arquitecto") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { Client, Notification, Quote, User, Work, Worker } = await import("../src/lib/models");
const planRoute = await import("../src/app/api/works/plan/route");
const convertRoute = await import("../src/app/api/quotes/[id]/convert/route");
const recordsRoute = await import("../src/app/api/records/[entity]/route");

let server: MongoMemoryServer;
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const json = (body: unknown) => new Request("http://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const day = (value: unknown) => new Date(value as string).toISOString().slice(0, 10);

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("planificar");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("planificar la obra de una cotización aprobada", () => {
  it("crea la obra con fechas en días hábiles, responsable y personal, resuelve el aviso de Producción y avisa la fecha", async () => {
    const client = await Client.create({ name: "Consorcio Costanera", cuit: "30-77777777-7" });
    const quote = await Quote.create({ number: "V 01-1600", clientId: client._id, title: "Pintura de fachada Costanera", amountCents: 12_100_000_00, netCents: 10_000_000_00, status: "aprobada" });
    const [ana, beto] = await Worker.create([{ firstName: "Ana", lastName: "Sosa", dailyRateCents: 40_000_00 }, { firstName: "Beto", lastName: "Ruiz", category: "ayudante", dailyRateCents: 30_000_00 }]);
    const manager = await User.create({ name: "Fede", email: "fede@test.local", role: "arquitecto" });
    await Notification.create({ title: "Cotización aprobada: planificar la obra", roles: ["arquitecto"], kind: "cotizacion", status: "nueva", dedupeKey: `quote-approved-${String(quote._id)}-produccion` });

    // Obras ve que la cotización espera su obra, y el panel propone el código y trae los legajos.
    const waiting = await call(await planRoute.GET(new Request("http://test/api/works/plan")));
    expect(waiting.body.quotes).toMatchObject([{ _id: String(quote._id), number: "V 01-1600", clientName: "Consorcio Costanera" }]);
    const panel = await call(await planRoute.GET(new Request(`http://test/api/works/plan?quoteId=${String(quote._id)}`)));
    expect(panel.body).toMatchObject({ work: null, suggestedCode: "OB-V 01-1600", suggestedName: "Pintura de fachada Costanera" });
    expect(panel.body.workers.map((worker: { name: string }) => worker.name).sort()).toEqual(["Ruiz, Beto", "Sosa, Ana"]);
    expect(panel.body.holidays).toContain("2026-12-08");

    // Sin duración ni fin no se guarda.
    expect((await call(await planRoute.POST(json({ quoteId: String(quote._id), startDate: "2026-12-01", workerIds: [] })))).status).toBe(400);

    // Seis días hábiles desde el martes 1/12: saltea el fin de semana y el feriado del 8/12, termina el 9/12.
    const planned = await call(await planRoute.POST(json({ quoteId: String(quote._id), code: "OB-1600", name: "Fachada Costanera", startDate: "2026-12-01", durationBusinessDays: 6, managerId: String(manager._id), workerIds: [String(ana._id), String(beto._id)], note: "Andamios el lunes" })));
    expect(planned.status).toBe(201);
    expect(planned.body).toMatchObject({ created: true, kept: [] });
    const work = await Work.findOne({ quoteId: quote._id }).lean<Record<string, unknown>>();
    expect(work).toMatchObject({ code: "OB-1600", name: "Fachada Costanera", status: "planificada", budgetCents: 12_100_000_00, budgetNetCents: 10_000_000_00 });
    expect([day(work!.startDate), day(work!.endDate)]).toEqual(["2026-12-01", "2026-12-09"]);
    expect(String(work!.managerId)).toBe(String(manager._id));
    expect((work!.assignedWorkers as Array<{ name: string; dailyRateCents: number }>).map(row => [row.name, row.dailyRateCents])).toEqual([["Sosa, Ana", 40_000_00], ["Ruiz, Beto", 30_000_00]]);
    // La cotización pasó a obra, el aviso de Producción quedó resuelto y Compras y Administración tienen la fecha.
    expect(await Quote.findById(quote._id).lean()).toMatchObject({ status: "convertida", workId: work!._id });
    expect(await Notification.findOne({ dedupeKey: `quote-approved-${String(quote._id)}-produccion` }).lean()).toMatchObject({ status: "resuelta", doneByName: "Fede" });
    const notice = await Notification.findOne({ dedupeKey: `work-planned-${String(work!._id)}-2026-12-01` }).lean<{ title: string; body: string; roles: string[] }>();
    expect(notice).toMatchObject({ roles: ["compras", "administracion"] });
    expect(notice!.body).toContain("Andamios el lunes");
    expect((await call(await planRoute.GET(new Request("http://test/api/works/plan")))).body.quotes).toEqual([]);

    // Volver a planificar: se saca a Beto; Ana ya tiene horas cargadas y queda aunque no se la elija.
    await Work.updateOne({ _id: work!._id }, { $push: { labor: { workerId: ana._id, person: "Sosa, Ana", date: new Date("2026-12-01"), mode: "jornada", days: 1, costCents: 40_000_00 } } });
    const again = await call(await planRoute.POST(json({ workId: String(work!._id), startDate: "2026-12-02", endDate: "2026-12-11", workerIds: [] })));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, kept: ["Sosa, Ana"] });
    const replanned = await Work.findById(work!._id).lean<Record<string, unknown>>();
    expect([day(replanned!.startDate), day(replanned!.endDate)]).toEqual(["2026-12-02", "2026-12-11"]);
    expect((replanned!.assignedWorkers as Array<{ name: string }>).map(row => row.name)).toEqual(["Sosa, Ana"]);
    // El panel de la obra muestra lo planificado y avisa que Ana ya está en otra obra si se la quiere sumar a una nueva.
    const reopened = await call(await planRoute.GET(new Request(`http://test/api/works/plan?workId=${String(work!._id)}`)));
    expect(reopened.body.work).toMatchObject({ code: "OB-1600", startDate: "2026-12-02", endDate: "2026-12-11", durationBusinessDays: 7, assigned: [{ name: "Sosa, Ana", hasLabor: true }] });
  });

  it("\"Sin planificar\" trae las obras pendientes de inicio sin fecha o sin gente, y una cotización sin aprobar no se planifica", async () => {
    const client = await Client.create({ name: "Cliente sin plan" });
    const loose = await Work.create({ code: "OB-SIN-PLAN", name: "Obra sin fechas", clientId: client._id, status: "planificada" });
    const list = await call(await recordsRoute.GET(new Request("http://test/api/records/works?unplanned=1"), params({ entity: "works" })));
    const codes = list.body.items.map((item: { code: string }) => item.code);
    expect(codes).toContain("OB-SIN-PLAN");
    expect(codes).not.toContain("OB-1600");
    expect((await call(await planRoute.GET(new Request("http://test/api/works/plan")))).body.unplannedWorks).toBeGreaterThanOrEqual(1);

    // Con fecha y una persona deja de estar sin planificar.
    const [worker] = await Worker.create([{ firstName: "Caro", lastName: "Paz" }]);
    await planRoute.POST(json({ workId: String(loose._id), startDate: "2026-12-14", durationBusinessDays: 3, workerIds: [String(worker._id)] }));
    const after = await call(await recordsRoute.GET(new Request("http://test/api/records/works?unplanned=1"), params({ entity: "works" })));
    expect(after.body.items.map((item: { code: string }) => item.code)).not.toContain("OB-SIN-PLAN");

    const draft = await Quote.create({ number: "V 01-1601", clientId: client._id, title: "Todavía en borrador", amountCents: 1_000_00, status: "borrador" });
    const refused = await call(await planRoute.POST(json({ quoteId: String(draft._id), startDate: "2026-12-01", durationBusinessDays: 2, workerIds: [] })));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("aprobada");
    // "Pasar a obra" sigue pidiendo el permiso de Cotizaciones, que Producción no tiene.
    expect((await convertRoute.POST(json({ code: "OB-X", name: "X" }), params({ id: String(draft._id) }))).status).toBe(403);
  });
});
