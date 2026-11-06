import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";

const session = { userId: new Types.ObjectId().toHexString(), name: "Gerencia de prueba", email: "gerencia@test.local", role: "gerencia" as "gerencia" | "administracion", permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { Account, CashAccount, CashMovement, Client, Invoice } = await import("../src/lib/models");
const recordsRoute = await import("../src/app/api/records/[entity]/route");
const recordRoute = await import("../src/app/api/records/[entity]/[id]/route");
const transferRoute = await import("../src/app/api/cash/transfer/route");
const receiptsRoute = await import("../src/app/api/receipts/route");
const ledgerRoute = await import("../src/app/api/accounting/ledger/route");
const { cashAccountKey } = await import("../src/lib/cash-accounts");

let server: MongoMemoryServer;
let uri = "";
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const json = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const post = async (entity: string, body: unknown) => call(await recordsRoute.POST(json("POST", body), params({ entity })));
const patch = async (entity: string, id: string, body: unknown) => call(await recordRoute.PATCH(json("PATCH", body), params({ entity, id })));
const accountId = async (name: string) => String((await Account.findOne({ name }).lean<{ _id: Types.ObjectId }>())!._id);

function asRole(role: "gerencia" | "administracion") {
  session.role = role;
  session.permissions = defaultPermissionsForRole(role);
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  uri = server.getUri("cajas");
  process.env.MONGODB_URI = uri;
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
  const { ensureAccountCatalog } = await import("../src/lib/account-service");
  await ensureAccountCatalog();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("maestro de cajas y cuentas bancarias", () => {
  it("no repite nombres aunque se escriban distinto, y el saldo inicial lo pone sólo Gerencia", async () => {
    expect(cashAccountKey("Bco. Nación  TVP")).toBe(cashAccountKey("bco nacion tvp"));
    asRole("gerencia");
    const nacion = await post("cashAccounts", { company: "tvp", name: "Bco. Nación TVP", type: "cuenta_corriente", bank: "Banco Nación", openingBalanceCents: 1_000_000_00, openingDate: "2026-10-01" });
    expect(nacion.status).toBe(201);
    const twin = await post("cashAccounts", { company: "tvp", name: "bco nacion tvp", type: "cuenta_corriente" });
    expect(twin.status).toBe(409);

    asRole("administracion");
    // Administración da de alta cuentas, pero sin saldo inicial.
    expect((await post("cashAccounts", { company: "constructora", name: "Caja pesos Constructora", type: "caja", openingBalanceCents: 50_000_00 })).status).toBe(403);
    const caja = await post("cashAccounts", { company: "constructora", name: "Caja pesos Constructora", type: "caja" });
    expect(caja.status).toBe(201);
    expect((await patch("cashAccounts", caja.body._id, { openingBalanceCents: 10_00 })).status).toBe(403);
    // Cambiar otras cosas (mandando el mismo saldo) sí.
    expect((await patch("cashAccounts", nacion.body._id, { bank: "Banco de la Nación Argentina", openingBalanceCents: 1_000_000_00 })).status).toBe(200);
    asRole("gerencia");
  });

  it("cada movimiento elige una cuenta activa del maestro, de su empresa; un nombre nuevo no crea nada", async () => {
    const nacion = String((await CashAccount.findOne({ nameKey: "bco nacion tvp" }).lean<{ _id: unknown }>())!._id);
    const cajaConstructora = String((await CashAccount.findOne({ nameKey: "caja pesos constructora" }).lean<{ _id: unknown }>())!._id);
    const ggi = await accountId("GGI - Alquileres");
    const base = { date: "2026-10-02", direction: "egreso", description: "Alquiler", amountCents: 100_000_00, accountId: ggi };

    expect((await post("cash", base)).status).toBe(400);
    const unknown = await post("cash", { ...base, account: "Caja nueva que nadie dio de alta" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toContain("No existe");
    expect(await CashAccount.countDocuments()).toBe(2);

    // Con el nombre de una que existe, la encuentra (una planilla importada).
    const byName = await post("cash", { ...base, account: "BCO NACION TVP" });
    expect(byName.status).toBe(201);
    expect(byName.body).toMatchObject({ cashAccountId: nacion, account: "Bco. Nación TVP", company: "tvp" });

    // Una cuenta de la otra empresa no.
    expect((await post("cash", { ...base, company: "tvp", cashAccountId: cajaConstructora })).status).toBe(400);
    // Inactiva tampoco.
    await patch("cashAccounts", cajaConstructora, { active: "false" });
    const inactive = await post("cash", { ...base, cashAccountId: cajaConstructora });
    expect(inactive.body.error).toContain("inactiva");
    await patch("cashAccounts", cajaConstructora, { active: "true" });

    // Un movimiento de antes de la fecha de corte no suma al saldo.
    await post("cash", { ...base, date: "2026-09-15", cashAccountId: nacion, description: "De antes del corte" });
  });

  it("el saldo es el inicial más lo que entró menos lo que salió, y el pase mueve la plata sin sumar a ingresos ni egresos", async () => {
    const nacion = String((await CashAccount.findOne({ nameKey: "bco nacion tvp" }).lean<{ _id: unknown }>())!._id);
    const caja = await post("cashAccounts", { company: "tvp", name: "Caja chica TVP", type: "caja" });
    // Un cobro entra al banco.
    const client = await Client.create({ name: "Cliente cajas" });
    const invoice = await Invoice.create({ company: "tvp", voucherType: "factura_a", number: "0003-00009001", clientId: client._id, issueDate: new Date("2026-10-03"), amountCents: 242_000_00, status: "pendiente" });
    const receipt = await call(await receiptsRoute.POST(json("POST", { accountId: await accountId("CI - CERTIFICADOS"), cashAccountId: nacion, clientId: String(client._id), date: "2026-10-03", method: "transferencia", allocations: [{ invoiceId: String(invoice._id), amountCents: 242_000_00 }] })));
    expect(receipt.status).toBe(201);
    expect(receipt.body.receipt).toMatchObject({ cashAccountId: nacion, account: "Bco. Nación TVP" });
    // Un recibo no entra a una cuenta de otra empresa.
    const cajaConstructora = String((await CashAccount.findOne({ nameKey: "caja pesos constructora" }).lean<{ _id: unknown }>())!._id);
    const otherInvoice = await Invoice.create({ company: "tvp", voucherType: "factura_a", number: "0003-00009002", clientId: client._id, issueDate: new Date("2026-10-03"), amountCents: 1_000_00, status: "pendiente" });
    expect((await call(await receiptsRoute.POST(json("POST", { accountId: await accountId("CI - CERTIFICADOS"), cashAccountId: cajaConstructora, clientId: String(client._id), date: "2026-10-03", method: "efectivo", allocations: [{ invoiceId: String(otherInvoice._id), amountCents: 1_000_00 }] })))).status).toBe(409);

    // Un pase del banco a la caja chica.
    const transfer = await call(await transferRoute.POST(json("POST", { date: "2026-10-04", from: nacion, to: caja.body._id, amountCents: 50_000_00 })));
    expect(transfer.status).toBe(201);
    expect(await CashMovement.countDocuments({ transferId: transfer.body.transferId, company: "tvp" })).toBe(2);

    const list = await call(await recordsRoute.GET(new Request("http://test/api/records/cashAccounts?limit=100"), params({ entity: "cashAccounts" })));
    const balance = (name: string) => list.body.items.find((item: { name: string }) => item.name === name).balanceCents;
    // 1.000.000 inicial − 100.000 alquiler + 242.000 cobro − 50.000 pase (el de antes del corte no cuenta).
    expect(balance("Bco. Nación TVP")).toBe(1_092_000_00);
    expect(balance("Caja chica TVP")).toBe(50_000_00);

    // En los movimientos por cuenta el pase aparece, pero no suma a los totales.
    const ledger = await call(await ledgerRoute.GET(new Request("http://test/api/accounting/ledger?from=2026-10-01&to=2026-10-31")));
    expect(ledger.body.transfers).toMatchObject({ count: 2, inCents: 50_000_00, outCents: 50_000_00 });
    expect(ledger.body.totals).toMatchObject({ inCents: 242_000_00, outCents: 100_000_00 });
  });

  it("una cuenta usada no se borra, se inactiva; una sin uso, sí", async () => {
    const nacion = String((await CashAccount.findOne({ nameKey: "bco nacion tvp" }).lean<{ _id: unknown }>())!._id);
    const used = await call(await recordRoute.DELETE(new Request("http://test", { method: "DELETE" }), params({ entity: "cashAccounts", id: nacion })));
    expect(used.status).toBe(400);
    expect(used.body.error).toContain("inactiva");
    const unused = await post("cashAccounts", { company: "tvp", name: "Cuenta de prueba", type: "otra" });
    expect((await call(await recordRoute.DELETE(new Request("http://test", { method: "DELETE" }), params({ entity: "cashAccounts", id: unused.body._id })))).status).toBe(200);
  });

  it("cada cuenta tiene su código sin repetir, como en TANGO, y la lista va por código", async () => {
    asRole("gerencia");
    const nacion = String((await CashAccount.findOne({ nameKey: "bco nacion tvp" }).lean<{ _id: unknown }>())!._id);
    expect((await patch("cashAccounts", nacion, { code: "33" })).status).toBe(200);
    const twin = await post("cashAccounts", { code: 33, company: "tvp", name: "Banco Macro TVP", type: "cuenta_corriente" });
    expect(twin.status).toBe(409);
    expect(twin.body.error).toContain("Bco. Nación TVP");
    expect((await post("cashAccounts", { code: 32, company: "tvp", name: "Banco Macro TVP", type: "cuenta_corriente" })).status).toBe(201);

    const list = await call(await recordsRoute.GET(new Request("http://test/api/records/cashAccounts?limit=100"), params({ entity: "cashAccounts" })));
    const coded = list.body.items.filter((item: { code?: number }) => item.code).map((item: { code: number }) => item.code);
    expect(coded).toEqual([32, 33]);
    // Se busca por el número.
    const search = await call(await recordsRoute.GET(new Request("http://test/api/records/cashAccounts?search=33"), params({ entity: "cashAccounts" })));
    expect(search.body.items.map((item: { name: string }) => item.name)).toEqual(["Bco. Nación TVP"]);
  });

  it("una caja de las dos empresas sirve para las dos; en un pase toma la empresa de la otra cuenta", async () => {
    const efectivo = await post("cashAccounts", { code: 50, company: "ambas", name: "Caja Efectivo", type: "caja" });
    expect(efectivo.status).toBe(201);
    const dolares = await post("cashAccounts", { code: 51, company: "ambas", name: "Caja Dólares", type: "caja", currency: "USD" });
    expect((await post("cashAccounts", { code: 52, company: "ambas", name: "Caja Reales", type: "caja", currency: "BRL" })).status).toBe(201);
    const base = { date: "2026-10-05", direction: "egreso", description: "Viáticos", amountCents: 10_000_00, accountId: await accountId("GGI - Alquileres"), cashAccountId: efectivo.body._id };
    expect((await post("cash", { ...base, company: "tvp" })).body.company).toBe("tvp");
    expect((await post("cash", { ...base, company: "constructora" })).body.company).toBe("constructora");
    // Sin empresa, no toma ninguna: la caja es de las dos.
    expect((await post("cash", base)).body.company).toBeUndefined();

    const nacion = String((await CashAccount.findOne({ nameKey: "bco nacion tvp" }).lean<{ _id: unknown }>())!._id);
    const deposit = await call(await transferRoute.POST(json("POST", { date: "2026-10-05", from: efectivo.body._id, to: nacion, amountCents: 5_000_00 })));
    expect(await CashMovement.countDocuments({ transferId: deposit.body.transferId, company: "tvp" })).toBe(2);
    const between = await call(await transferRoute.POST(json("POST", { date: "2026-10-05", from: efectivo.body._id, to: dolares.body._id, amountCents: 1_000_00 })));
    expect(await CashMovement.countDocuments({ transferId: between.body.transferId, company: { $exists: true } })).toBe(0);
  });

  it("la cuenta de cheques diferidos se debita de un banco de su misma empresa", async () => {
    const macro = String((await CashAccount.findOne({ code: 32 }).lean<{ _id: unknown }>())!._id);
    const corrientes = await post("cashAccounts", { code: 10, company: "constructora", name: "Banco Corrientes Constructora", type: "cuenta_corriente" });
    const wrong = await post("cashAccounts", { code: 20, company: "constructora", name: "Cheques diferidos Corrientes Constructora", type: "cheques_diferidos", bankAccountId: macro });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toContain("misma empresa");
    const right = await post("cashAccounts", { code: 42, company: "tvp", name: "Cheques diferidos Macro TVP", type: "cheques_diferidos", bankAccountId: macro });
    expect(right.status).toBe(201);
    expect(right.body.bankAccountId).toBe(macro);
    expect(corrientes.status).toBe(201);
  });
});

describe("carga del maestro con los códigos acordados", () => {
  it("completa las que ya existen, da de alta las que faltan y ata cada cuenta de cheques diferidos a su banco", async () => {
    const run = (...args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/load-cash-accounts.ts", ...args], { env: { ...process.env, MONGODB_URI: uri } });
    const before = await CashAccount.countDocuments();
    const dry = await run();
    expect(dry.stdout).toContain("No se cambió nada");
    expect(await CashAccount.countDocuments()).toBe(before);

    await run("--apply");
    // La 33 ya existía con otro nombre: se completa, no se duplica.
    expect(await CashAccount.countDocuments({ code: 33 })).toBe(1);
    expect(await CashAccount.findOne({ code: 33 }).lean()).toMatchObject({ name: "Bco. Nación TVP", company: "tvp", type: "cuenta_corriente" });
    expect(await CashAccount.findOne({ code: 53 }).lean()).toMatchObject({ name: "Caja Euros", company: "ambas", currency: "EUR" });
    const nacion = await CashAccount.findOne({ code: 33 }).lean<{ _id: unknown }>();
    expect(String((await CashAccount.findOne({ code: 43 }).lean<{ bankAccountId: unknown }>())!.bankAccountId)).toBe(String(nacion!._id));
    for (const code of [1, 6, 10, 20, 30, 31, 32, 33, 34, 40, 41, 42, 43, 44, 50, 51, 52, 53, 54, 60, 61, 62, 70, 71, 72]) expect(await CashAccount.exists({ code })).toBeTruthy();

    // Correrlo de nuevo no cambia nada.
    const again = await run();
    expect(again.stdout).not.toContain("→ nueva");
  }, 60_000);
});

describe("migración de los nombres que se usaban", () => {
  it("agrupa los nombres escritos distinto, crea una cuenta por grupo y ata los movimientos", async () => {
    const db = mongoose.connection;
    const ggi = new Types.ObjectId(await accountId("GGI - Alquileres"));
    await db.collection("cashmovements").insertMany([
      { date: new Date(), direction: "egreso", account: "Banco Galicia", description: "a", amountCents: 1, accountId: ggi, company: "constructora" },
      { date: new Date(), direction: "egreso", account: "banco galicia", description: "b", amountCents: 1, accountId: ggi, company: "constructora" },
      { date: new Date(), direction: "ingreso", account: "Galicia", description: "c", amountCents: 1, accountId: ggi },
    ]);
    await db.collection("payments").insertOne({ date: new Date(), amountCents: 1, method: "efectivo", account: "Caja grande", company: "tvp" });
    const run = (...args: string[]) => promisify(execFile)(process.execPath, ["scripts/migrate-cash-accounts.mjs", ...args], { env: { ...process.env, MONGODB_URI: uri } });

    // Sin --apply no toca nada.
    const dry = await run();
    expect(dry.stdout).toContain("modo prueba");
    expect(await CashAccount.countDocuments({ nameKey: "banco galicia" })).toBe(0);

    // Con el mapa, "Galicia" va a la misma cuenta.
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const mapFile = join(mkdtempSync(join(tmpdir(), "cajas-")), "mapa.json");
    writeFileSync(mapFile, JSON.stringify({ Galicia: "Banco Galicia" }));
    await run("--apply", "--map", mapFile);
    const galicia = await CashAccount.findOne({ nameKey: "banco galicia" }).lean<{ _id: unknown; company: string; type: string }>();
    expect(galicia).toMatchObject({ company: "constructora", type: "cuenta_corriente" });
    expect(await CashMovement.countDocuments({ cashAccountId: galicia!._id })).toBe(3);
    expect(await CashAccount.findOne({ nameKey: "caja grande" }).lean()).toMatchObject({ type: "caja", company: "tvp" });
    expect(await db.collection("payments").countDocuments({ cashAccountId: { $exists: true } })).toBe(1);
  }, 60_000);
});
