import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";

const session = { userId: new Types.ObjectId().toHexString(), name: "Administración de prueba", email: "admin@test.local", role: "gerencia" as const, permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { Client, Work, Worker, WorkType } = await import("../src/lib/models");
const recordsRoute = await import("../src/app/api/records/[entity]/route");
const recordRoute = await import("../src/app/api/records/[entity]/[id]/route");
const statusRoute = await import("../src/app/api/workers/[id]/status/route");
const workTypesRoute = await import("../src/app/api/work-types/route");
const laborRoute = await import("../src/app/api/works/[id]/labor/route");
const payrollRoute = await import("../src/app/api/payroll/route");
const { parsePayrollWorkbook, previewPayroll, importPayroll } = await import("../src/lib/payroll-import");

let server: MongoMemoryServer;
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const json = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("personal");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("legajos, baja y reactivación", () => {
  it("asigna legajos, no los repite y al volver da uno nuevo", async () => {
    const first = await call(await recordsRoute.POST(json("POST", { fileNumber: 172, lastName: "PEREZ", firstName: "JUAN", category: "oficial" }), params({ entity: "workers" })));
    expect(first.body).toMatchObject({ fileNumber: 172, active: true, name: "PEREZ, JUAN" });
    // Sin número, el siguiente al más alto.
    const second = await call(await recordsRoute.POST(json("POST", { lastName: "GOMEZ", firstName: "ANA", category: "ayudante", dni: "" }), params({ entity: "workers" })));
    expect(second.body.fileNumber).toBe(173);
    // Un legajo ocupado no se puede usar.
    const repeated = await call(await recordsRoute.POST(json("POST", { fileNumber: 172, lastName: "OTRO", firstName: "X", category: "oficial" }), params({ entity: "workers" })));
    expect(repeated).toMatchObject({ status: 409, body: { error: expect.stringContaining("PEREZ, JUAN") } });

    // Baja con fecha y motivo.
    const left = await call(await statusRoute.POST(json("POST", { action: "baja", date: "2026-09-15", reason: "Fin de obra" }), params({ id: first.body._id })));
    expect(left.body).toMatchObject({ active: false, leaveReason: "Fin de obra", fileHistory: [{ fileNumber: 172, reason: "Fin de obra" }] });
    expect((await call(await statusRoute.POST(json("POST", { action: "baja", date: "2026-09-16" }), params({ id: first.body._id })))).status).toBe(409);
    // El 172 ya no lo puede tomar nadie.
    expect((await call(await recordRoute.PATCH(json("PATCH", { fileNumber: 172 }), params({ entity: "workers", id: second.body._id })))).status).toBe(409);

    // Vuelve: legajo nuevo, el viejo queda en el historial.
    const back = await call(await statusRoute.POST(json("POST", { action: "alta", date: "2026-10-01" }), params({ id: first.body._id })));
    expect(back.body).toMatchObject({ active: true, fileNumber: 174, fileHistory: [{ fileNumber: 172 }] });
    // Se busca por legajo.
    const found = await call(await recordsRoute.GET(new Request("http://test/api/records/workers?search=174"), params({ entity: "workers" })));
    expect(found.body.items.map((worker: { name: string }) => worker.name)).toEqual(["PEREZ, JUAN"]);
  });
});

describe("tarifas, partes por tipo de trabajo y liquidación de la quincena", () => {
  it("carga horas y plus el mismo día, cada uno a su tarifa, y lo liquida", async () => {
    const saved = await call(await workTypesRoute.PUT(json("PUT", { items: [
      { name: "Medio Oficial", unit: "hora", rateCents: 5_866_00 },
      { name: "PLUS VIAJE AYUD 40%", unit: "unidad", rateCents: 15_900_00 },
    ] })));
    expect(saved.body.items.map((type: { name: string }) => type.name)).toEqual(["Medio Oficial", "PLUS VIAJE AYUD 40%"]);
    const [medio, plus] = saved.body.items as Array<{ _id: string }>;
    // Cambiar una tarifa la deja en el historial.
    await workTypesRoute.PUT(json("PUT", { items: [{ _id: medio._id, name: "Medio Oficial", unit: "hora", rateCents: 6_000_00 }, { _id: plus._id, name: "PLUS VIAJE AYUD 40%", unit: "unidad", rateCents: 15_900_00 }] }));
    expect((await WorkType.findById(medio._id).lean() as { history: Array<{ rateCents: number }> }).history.map(entry => entry.rateCents)).toEqual([5_866_00, 6_000_00]);

    const client = await Client.create({ name: "Cliente liquidación" });
    const work = await Work.create({ code: "OB-LQ", name: "Virasoro", clientId: client._id, status: "en_curso" });
    const worker = await Worker.create({ lastName: "ACOSTA", firstName: "NAHUEL", name: "ACOSTA, NAHUEL", fileNumber: 500, workType: "Medio Oficial" });
    work.assignedWorkers.push({ workerId: worker._id, name: worker.name, rateMode: "hora" });
    await work.save();

    const hours = await call(await laborRoute.POST(json("POST", { workerId: String(worker._id), date: "2026-09-10", quantity: 10, workTypeId: medio._id }), params({ id: String(work._id) })));
    expect(hours.status).toBe(201);
    await laborRoute.POST(json("POST", { workerId: String(worker._id), date: "2026-09-10", quantity: 1, workTypeId: plus._id }), params({ id: String(work._id) }));
    const entries = (await Work.findById(work._id).lean() as { labor: Array<{ workType: string; unit: string; costCents: number }> }).labor;
    expect(entries.map(entry => [entry.workType, entry.unit, entry.costCents])).toEqual([["Medio Oficial", "hora", 60_000_00], ["PLUS VIAJE AYUD 40%", "unidad", 15_900_00]]);

    const settlement = await call(await payrollRoute.GET(new Request("http://test/api/payroll?from=2026-09-01&to=2026-09-15")));
    expect(settlement.body.totals).toMatchObject({ people: 1, hours: 10, cents: 75_900_00 });
    expect(settlement.body.rows[0]).toMatchObject({ fileNumber: 500, name: "ACOSTA, NAHUEL", hours: 10, totalCents: 75_900_00, byType: [{ workType: "Medio Oficial", quantity: 10 }, { workType: "PLUS VIAJE AYUD 40%", quantity: 1 }] });
    expect((await call(await payrollRoute.GET(new Request("http://test/api/payroll?from=2026-09-16&to=2026-09-30")))).body.totals.people).toBe(0);
  });

  it("importa la planilla de la quincena sin duplicar y con los mismos totales", async () => {
    const client = await Client.create({ name: "Consorcio Unidad" });
    const existing = await Work.create({ code: "OB-UNI", name: "UNIDAD", clientId: client._id, status: "en_curso" });
    const known = await Worker.create({ lastName: "BARRIOS", firstName: "FRANCO ISMAEL", name: "BARRIOS, FRANCO ISMAEL", category: "medio_oficial" });
    // En el legajo tiene el nombre completo; en la planilla, sin el segundo nombre.
    const longName = await Worker.create({ lastName: "IBARRA", firstName: "DANIEL OSCAR", name: "IBARRA, DANIEL OSCAR", category: "ayudante" });
    // Dos candidatos posibles: no se adivina.
    await Worker.create({ lastName: "GOMEZ", firstName: "RAMON IGNACIO", name: "GOMEZ, RAMON IGNACIO" });
    await Worker.create({ lastName: "GOMEZ", firstName: "RAMON ROBERTO", name: "GOMEZ, RAMON ROBERTO" });
    const sheet = { sheet: "1ra15na sep-26", data: [
      ["PRIMERA QUINCENA DE SEPTIEMBRE", null, null, null, null, null, null, null, null, null, null],
      ["Nº Legajo", "Apellido y Nombre", "Categoría", "Día", "T. Trabajo", "Horas", "Obra", "Total 15na $", null, "PRIMERA QUINCENA", null],
      [151, "BARRIOS FRANCO ISMAEL", "SILLETERO (M.O) ASISTENTE", day("2026-09-02"), "M.O Altura", 10, "UNIDAD", 59_000, null, "CATEGORIA", "HORA"],
      [151, "BARRIOS FRANCO ISMAEL", "SILLETERO (M.O) ASISTENTE", day("2026-09-03"), "M.O Altura", 10, "UNIDAD", 59_000, null, "M.O Altura", 5_900],
      [151, "BARRIOS FRANCO ISMAEL", "SILLETERO (M.O) ASISTENTE", day("2026-09-03"), "PLUS VIAJE AYUD 40%", 1, "V1397 AYACUCHO SHELL", 15_900, null, "PLUS VIAJE AYUD 40%", 15_900],
      [900, "NUEVO APELLIDO PEDRO", "PINTOR OFICIAL", "04/09/2026", "Oficial", 8.5, "V1397 AYACUCHO SHELL", 53_958, null, "Oficial", 6_348],
      [321, "IBARRA DANIEL", "AYUDANTE", day("2026-09-04"), "Oficial", 1, "UNIDAD", 6_348, null, null, null],
      [322, "GOMEZ RAMON", "OFICIAL", day("2026-09-04"), "Oficial", 1, "UNIDAD", 6_348, null, null, null],
      [null, "Total", null, null, null, 29.5, null, 187_858, null, null, null],
    ] };
    const parsed = parsePayrollWorkbook([sheet]);
    expect(parsed.rows).toHaveLength(6);
    expect(parsed.rates).toEqual([{ name: "M.O Altura", rateCents: 5_900_00 }, { name: "PLUS VIAJE AYUD 40%", rateCents: 15_900_00 }, { name: "Oficial", rateCents: 6_348_00 }]);

    const preview = await previewPayroll(parsed);
    expect(preview).toMatchObject({ rows: 6, totalCents: 200_554_00, alreadyLoaded: 0, people: { total: 4, matched: 2, toCreate: ["NUEVO APELLIDO PEDRO", "GOMEZ RAMON"] } });
    expect(preview.sites.find(site => site.site === "UNIDAD")).toMatchObject({ workId: String(existing._id) });
    expect(preview.sites.find(site => site.site === "V1397 AYACUCHO SHELL")).toMatchObject({ workId: "" });

    // Sin elegir a dónde va cada obra no se carga.
    await expect(importPayroll(parsed, { UNIDAD: String(existing._id) }, session)).rejects.toThrow(/V1397/);
    const summary = await importPayroll(parsed, { UNIDAD: String(existing._id), "V1397 AYACUCHO SHELL": "new" }, session);
    expect(summary).toMatchObject({ entries: 6, skipped: 0, workersCreated: 2, fileNumbersSet: 2, worksCreated: 1, totalCents: 200_554_00, conflicts: [] });
    expect(await Worker.findById(longName._id).lean()).toMatchObject({ fileNumber: 321 });
    expect(await Worker.findById(known._id).lean()).toMatchObject({ fileNumber: 151, position: "SILLETERO (M.O) ASISTENTE", workType: "M.O Altura" });
    expect(await Worker.findOne({ fileNumber: 900 }).lean()).toMatchObject({ lastName: "NUEVO", firstName: "APELLIDO PEDRO", workType: "Oficial" });
    expect(await Work.findOne({ code: "V1397 AYACUCHO SHELL" }).lean()).toMatchObject({ name: "V1397 AYACUCHO SHELL", status: "en_curso" });

    // La misma planilla otra vez: no duplica.
    expect((await previewPayroll(parsed)).alreadyLoaded).toBe(6);
    const again = await importPayroll(parsed, { UNIDAD: String(existing._id), "V1397 AYACUCHO SHELL": String((await Work.findOne({ code: "V1397 AYACUCHO SHELL" }).lean() as { _id: unknown })._id) }, session);
    expect(again).toMatchObject({ entries: 0, skipped: 6 });

    // La liquidación del sistema da lo mismo que la planilla.
    const settlement = await call(await payrollRoute.GET(new Request("http://test/api/payroll?from=2026-09-01&to=2026-09-09")));
    const imported = settlement.body.rows.filter((row: { fileNumber: number }) => [151, 900, 321, 322].includes(row.fileNumber));
    expect(imported.reduce((total: number, row: { totalCents: number }) => total + row.totalCents, 0)).toBe(200_554_00);
    expect(imported.find((row: { fileNumber: number }) => row.fileNumber === 151)).toMatchObject({ hours: 20, totalCents: 133_900_00, lines: [{ workCode: "OB-UNI", workType: "M.O Altura", quantity: 10 }, { workType: "M.O Altura" }, { workType: "PLUS VIAJE AYUD 40%", unit: "unidad" }] });
  });
});

describe("importar el personal desde la planilla", () => {
  it("actualiza a quien ya está, lee el legajo y no toma los totales de la quincena como jornal", async () => {
    const importRoute = await import("../src/app/api/import/[entity]/route");
    await WorkType.create({ name: "SILLETERO 1", rateCents: 9_300_00 });
    const already = await Worker.create({ lastName: "ALMADA", firstName: "JUAN JOSE", name: "ALMADA, JUAN JOSE", dni: "34623476", category: "especialista", notes: "Categoría: SILLETERO 1. SILLETERO" });
    const csv = [
      "Nº Legajo;Apellido;Nombre;DNI;Teléfono;Categoría;Cómo cobra;Valor del jornal;Horas por jornal;Valor hora;Notas",
      "4;ALMADA;JUAN JOSE;34623476;3794076811;SILLETERO 1;Por hora;$ 846.300,00;91,00;$ 9.300,00;SILLETERO",
      "600;ZAPATA;OPERARIO;;;Oficial;Por hora;$ 488.796,00;77,00;$ 6.348,00;PINTOR OFICIAL",
    ].join("\r\n");
    const form = new FormData();
    form.set("file", new File([csv], "workers.csv", { type: "text/csv" }));
    const result = await call(await importRoute.POST(new Request("http://test", { method: "POST", body: form }), params({ entity: "workers" })));
    expect(result.body).toMatchObject({ imported: 1, updated: 1, errors: [] });
    const updated = await Worker.findById(already._id).lean();
    expect(updated).toMatchObject({ fileNumber: 4, workType: "SILLETERO 1", rateMode: "hora", hourlyRateCents: 9_300_00, phone: "3794076811", notes: "SILLETERO" });
    // 91 horas y $ 846.300 son de la quincena: no quedan como jornal.
    expect((updated as { dailyRateCents?: number }).dailyRateCents).toBe(0);
    expect(await Worker.countDocuments({ lastName: "ALMADA" })).toBe(1);
    expect(await Worker.findOne({ lastName: "ZAPATA" }).lean()).toMatchObject({ fileNumber: 600, hourlyRateCents: 6_348_00, active: true });
  });
});
