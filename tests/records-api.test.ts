import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";

/*
 * El alta y la edición genérica de registros (las tablas de cada módulo),
 * contra una base real en memoria. Lo único simulado es la sesión.
 */
const session = { userId: new Types.ObjectId().toHexString(), name: "Gerente", email: "gerencia@test.local", role: "gerencia" as const, permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session }));

const records = await import("../src/app/api/records/[entity]/route");
const record = await import("../src/app/api/records/[entity]/[id]/route");

let server: MongoMemoryServer;
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const send = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("registros");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("edición parcial de registros", () => {
  it("guarda obras sin presupuesto, las cuatro fechas y el avance manual sin borrar importes existentes", async () => {
    const clientId = new Types.ObjectId().toHexString();
    const created = await call(await records.POST(send("POST", {
      code: "OB-FECHAS", name: "Obra con fechas", clientId, status: "planificada",
      startDate: "2026-11-10", endDate: "2026-12-10", actualStartDate: "2026-11-12", actualEndDate: "",
    }), params({ entity: "works" })));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ budgetCents: 0, actualStartDate: "2026-11-12T00:00:00.000Z", actualEndDate: null });
    const workParams = params({ entity: "works", id: created.body._id });
    const { Work } = await import("../src/lib/models");
    await Work.updateOne({ _id: created.body._id }, { $set: { budgetCents: 12100, budgetNetCents: 10000 } });
    const updated = await call(await record.PATCH(send("PATCH", { progress: 50, status: "en_curso", actualEndDate: "2026-12-12" }), workParams));
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ progress: 50, progressMode: "manual", budgetCents: 12100, budgetNetCents: 10000, startDate: "2026-11-10T00:00:00.000Z", actualEndDate: "2026-12-12T00:00:00.000Z" });
    for (const body of [{ progress: -1 }, { progress: 101 }, { startDate: "2026-12-11" }, { actualEndDate: "2026-11-11" }]) {
      expect((await record.PATCH(send("PATCH", body), workParams)).status).toBe(400);
    }
    const cleared = await call(await record.PATCH(send("PATCH", { actualEndDate: "" }), workParams));
    expect(cleared.body.actualEndDate).toBeNull();
    expect(cleared.body.actualStartDate).toBe("2026-11-12T00:00:00.000Z");
  });

  it("impide pisar el avance calculado desde inspecciones", async () => {
    const { Work } = await import("../src/lib/models");
    const work = await Work.create({ code: "OB-INSPECCION", name: "Inspecciones", clientId: new Types.ObjectId(), progress: 25, progressMode: "inspecciones" });
    const workParams = params({ entity: "works", id: String(work._id) });
    expect((await record.PATCH(send("PATCH", { progress: 50 }), workParams)).status).toBe(400);
    const updated = await call(await record.PATCH(send("PATCH", { status: "pausada" }), workParams));
    expect(updated.body).toMatchObject({ status: "pausada", progress: 25, progressMode: "inspecciones" });
  });

  it("cambiar sólo el estado no borra lo demás (antes la descripción quedaba vacía)", async () => {
    const task = await call(await records.POST(send("POST", { title: "Pedir andamios", description: "Para la fachada de 9 de Julio", type: "general", status: "pendiente", assigneeRole: "compras" }), params({ entity: "tasks" })));
    expect(task.status).toBe(201);
    const done = await call(await record.PATCH(send("PATCH", { status: "completada" }), params({ entity: "tasks", id: task.body._id })));
    expect(done.body).toMatchObject({ status: "completada", description: "Para la fachada de 9 de Julio", assigneeRole: "compras" });

    const supplier = await call(await records.POST(send("POST", { name: "Protex", discountPct: 15, notes: "Lista cada 3 meses" }), params({ entity: "suppliers" })));
    const renamed = await call(await record.PATCH(send("PATCH", { name: "Protex (Prokrete)" }), params({ entity: "suppliers", id: supplier.body._id })));
    expect(renamed.body).toMatchObject({ name: "Protex (Prokrete)", discountPct: 15, notes: "Lista cada 3 meses" });
  });
});
