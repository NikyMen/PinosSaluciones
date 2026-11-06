import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole, type UserPermissions } from "../src/lib/permissions";
import type { Role } from "../src/lib/constants";

// Anexo de Tesorería v5.1 (validado con Administración): OP y recibos con varios medios, cheques, período y extracto por caja.
const session: { userId: string; name: string; email: string; role: Role; permissions: UserPermissions } = { userId: new Types.ObjectId().toHexString(), name: "Tesorería", email: "tesoreria@test.local", role: "administracion", permissions: defaultPermissionsForRole("administracion") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { Account, CashAccount, CashMovement, Check, Client, Expense, Invoice, Payment, Supplier } = await import("../src/lib/models");
const recordsRoute = await import("../src/app/api/records/[entity]/route");
const recordRoute = await import("../src/app/api/records/[entity]/[id]/route");
const ordersRoute = await import("../src/app/api/payment-orders/route");
const orderRoute = await import("../src/app/api/payment-orders/[id]/route");
const receiptsRoute = await import("../src/app/api/receipts/route");
const receiptRoute = await import("../src/app/api/receipts/[id]/route");
const debitRoute = await import("../src/app/api/checks/[id]/debit/route");
const depositRoute = await import("../src/app/api/checks/[id]/deposit/route");
const transferRoute = await import("../src/app/api/cash/transfer/route");
const { cashAccountBalances } = await import("../src/lib/cash-accounts");

let server: MongoMemoryServer;
let materiales = "";
let certificados = "";
const accounts: Record<string, string> = {};
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const json = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const receipt = "/api/uploads/comprobante.pdf";

async function account(key: string, data: Record<string, unknown>) {
  accounts[key] = String((await CashAccount.create({ nameKey: key, name: key, ...data }))._id);
  return accounts[key];
}

async function invoice(supplierId: string, number: string, amountCents: number, extra: Record<string, unknown> = {}) {
  const created = await call(await recordsRoute.POST(json("POST", { company: "tvp", supplierId, voucherType: "factura_a", number, description: "Materiales", category: "materiales", issueDate: "2026-10-01", status: "pendiente", amountCents, ...extra }), params({ entity: "expenses" })));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body as { _id: string; period?: string };
}

const pay = async (body: Record<string, unknown>) => call(await ordersRoute.POST(json("POST", { date: "2026-10-15", accountId: materiales, execute: true, ...body })));
const balance = async (key: string) => (await cashAccountBalances([(await CashAccount.findById(accounts[key]).lean())!] as never)).get(accounts[key]);

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("tesoreria-anexo");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
  const { ensureAccountCatalog } = await import("../src/lib/account-service");
  await ensureAccountCatalog();
  materiales = String((await Account.findOne({ name: "CC - Materiales" }).lean<{ _id: unknown }>())!._id);
  certificados = String((await Account.findOne({ name: "CI - CERTIFICADOS" }).lean<{ _id: unknown }>())!._id);
  await account("macro", { code: 32, company: "tvp", type: "cuenta_corriente" });
  await account("nacion", { code: 33, company: "tvp", type: "cuenta_corriente" });
  await account("chdif-macro", { code: 42, company: "tvp", type: "cheques_diferidos", bankAccountId: accounts.macro });
  await account("efectivo", { code: 50, company: "ambas", type: "caja" });
  await account("valores", { code: 70, company: "tvp", type: "valores_cobro" });
  await account("tarjeta", { code: 71, company: "tvp", type: "tarjeta_credito" });
  await account("retenciones", { code: 72, company: "tvp", type: "retenciones" });
  await account("corrientes-constructora", { code: 10, company: "constructora", type: "cuenta_corriente" });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("orden de pago con varios medios", () => {
  it("transferencia + cheque propio: suman el pago, cada uno sale de su cuenta y el cheque queda en la de cheques diferidos", async () => {
    const supplierId = String((await Supplier.create({ name: "Corralón Norte" }))._id);
    const f = await invoice(supplierId, "0001-00000001", 300_000_00);
    const allocations = [{ expenseId: f._id, amountCents: 300_000_00 }];
    const lines = [
      { method: "transferencia", cashAccountId: accounts.nacion, amountCents: 100_000_00, reference: "TR-55", attachment: receipt },
      { method: "cheque", cashAccountId: accounts.macro, amountCents: 200_000_00, attachment: receipt, check: { number: "1001", bank: "Banco Macro", dueDate: "2026-11-14" } },
    ];
    // La suma tiene que dar el pago.
    const short = await pay({ supplierId, allocations, lines: [lines[0]] });
    expect(short.body.error).toContain("diferencia");
    const created = await pay({ supplierId, allocations, lines });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.payment.lines).toEqual([
      expect.objectContaining({ method: "transferencia", cashAccountId: accounts.nacion, amountCents: 100_000_00 }),
      // Se eligió el banco: el cheque sale de su cuenta de cheques diferidos.
      expect.objectContaining({ method: "cheque", cashAccountId: accounts["chdif-macro"], amountCents: 200_000_00, checkId: expect.any(String) }),
    ]);
    expect(created.body.pdf.media).toHaveLength(2);
    expect(await Check.findById(created.body.payment.lines[1].checkId).lean()).toMatchObject({ direction: "emitido", status: "emitido", number: "1001", amountCents: 200_000_00 });
    expect(await balance("nacion")).toBe(-100_000_00);
    // El banco no baja hasta que debita el cheque.
    expect(await balance("macro")).toBe(0);
    expect(await balance("chdif-macro")).toBe(-200_000_00);
  });

  it("efectivo + transferencia + e-Cheq, y un pago parcial deja el saldo de la factura", async () => {
    const supplierId = String((await Supplier.create({ name: "Ferretería Sur" }))._id);
    const f = await invoice(supplierId, "0002-00000001", 100_000_00);
    const created = await pay({ supplierId, allocations: [{ expenseId: f._id, amountCents: 60_000_00 }], lines: [
      { method: "efectivo", cashAccountId: accounts.efectivo, amountCents: 10_000_00 },
      { method: "transferencia", cashAccountId: accounts.nacion, amountCents: 20_000_00, attachment: receipt },
      { method: "echeq", cashAccountId: accounts["chdif-macro"], amountCents: 30_000_00, attachment: receipt, check: { number: "E-9", bank: "Banco Macro", dueDate: "2026-11-20" } },
    ] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.payment.lines).toHaveLength(3);
    expect(await Expense.findById(f._id).lean()).toMatchObject({ paidCents: 60_000_00, status: "parcial" });
    // La caja compartida sirve para una OP de TV Pino.
    expect(await balance("efectivo")).toBe(-10_000_00);
  });

  it("cada medio usa una cuenta de su tipo y de la empresa de la OP", async () => {
    const supplierId = String((await Supplier.create({ name: "Pinturería" }))._id);
    const f = await invoice(supplierId, "0003-00000001", 10_000_00);
    const allocations = [{ expenseId: f._id, amountCents: 10_000_00 }];
    expect((await pay({ supplierId, allocations, lines: [{ method: "efectivo", cashAccountId: accounts.nacion, amountCents: 10_000_00 }] })).body.error).toContain("no sirve para pagar con efectivo");
    expect((await pay({ supplierId, allocations, lines: [{ method: "transferencia", cashAccountId: accounts["corrientes-constructora"], amountCents: 10_000_00, attachment: receipt }] })).body.error).toContain("Constructora");
    expect((await pay({ supplierId, allocations, lines: [{ method: "cheque", cashAccountId: accounts.nacion, amountCents: 10_000_00, attachment: receipt, check: { number: "1", bank: "Nación", dueDate: "2026-11-01" } }] })).body.error).toContain("no tiene cuenta de cheques diferidos");
    expect((await pay({ supplierId, allocations, lines: [{ method: "tarjeta", cashAccountId: accounts.tarjeta, amountCents: 10_000_00 }] })).status).toBe(201);
    expect(await balance("tarjeta")).toBe(-10_000_00);
  });

  it("el cheque de terceros sale de la cartera endosado; al anular la OP vuelve a la cartera", async () => {
    const supplierId = String((await Supplier.create({ name: "Andamios SA" }))._id);
    const f = await invoice(supplierId, "0004-00000001", 50_000_00);
    const check = await Check.create({ direction: "recibido", status: "cartera", bank: "Banco Galicia", number: "T-1", amountCents: 50_000_00, dueDate: new Date("2026-11-10"), cashAccountId: accounts.valores });
    const allocations = [{ expenseId: f._id, amountCents: 50_000_00 }];
    // Se endosa entero.
    expect((await pay({ supplierId, allocations: [{ expenseId: f._id, amountCents: 40_000_00 }], lines: [{ method: "cheque_tercero", checkId: String(check._id), amountCents: 40_000_00 }] })).body.error).toContain("se endosa entero");
    const created = await pay({ supplierId, allocations, lines: [{ method: "cheque_tercero", checkId: String(check._id), amountCents: 50_000_00 }] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.payment.lines[0]).toMatchObject({ cashAccountId: accounts.valores, checkId: String(check._id) });
    expect(await Check.findById(check._id).lean()).toMatchObject({ status: "endosado", paymentId: new Types.ObjectId(created.body.payment._id) });
    // No se puede usar dos veces.
    const other = await invoice(supplierId, "0004-00000002", 50_000_00);
    expect((await pay({ supplierId, allocations: [{ expenseId: other._id, amountCents: 50_000_00 }], lines: [{ method: "cheque_tercero", checkId: String(check._id), amountCents: 50_000_00 }] })).body.error).toContain("no está en cartera");

    expect((await call(await recordRoute.PATCH(json("PATCH", { status: "anulada" }), params({ entity: "payments", id: created.body.payment._id })))).status).toBe(200);
    expect(await Check.findById(check._id).lean()).toMatchObject({ status: "cartera" });
    expect((await Check.findById(check._id).lean<{ paymentId?: unknown }>())!.paymentId).toBeUndefined();
  });

  it("al editar la OP, el cheque propio que se deja de usar se borra; uno ya debitado no se puede sacar", async () => {
    const supplierId = String((await Supplier.create({ name: "Hormigonera" }))._id);
    const f = await invoice(supplierId, "0005-00000001", 80_000_00);
    const allocations = [{ expenseId: f._id, amountCents: 80_000_00 }];
    const created = await pay({ supplierId, allocations, lines: [{ method: "cheque", cashAccountId: accounts["chdif-macro"], amountCents: 80_000_00, attachment: receipt, check: { number: "2002", bank: "Banco Macro", dueDate: "2026-11-30" } }] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const checkId = created.body.payment.lines[0].checkId;
    const transfer = { supplierId, date: "2026-10-15", accountId: materiales, execute: true, allocations, lines: [{ method: "transferencia", cashAccountId: accounts.nacion, amountCents: 80_000_00, attachment: receipt }] };

    await Check.updateOne({ _id: checkId }, { $set: { status: "cobrado" } });
    expect((await call(await orderRoute.PUT(json("PUT", transfer), params({ id: created.body.payment._id })))).body.error).toContain("ya se debitó");
    await Check.updateOne({ _id: checkId }, { $set: { status: "emitido" } });
    const edited = await call(await orderRoute.PUT(json("PUT", transfer), params({ id: created.body.payment._id })));
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(await Check.exists({ _id: checkId })).toBeNull();
    expect((await Payment.findById(created.body.payment._id).lean<{ checkId?: unknown }>())!.checkId).toBeUndefined();
  });
});

async function sale(number: string, amountCents: number) {
  const client = await Client.create({ name: `Cliente ${number}` });
  const invoice = await Invoice.create({ company: "tvp", voucherType: "factura_a", number, clientId: client._id, issueDate: new Date("2026-10-03"), amountCents, status: "pendiente" });
  return { clientId: String(client._id), invoiceId: String(invoice._id) };
}
const collect = async (body: Record<string, unknown>) => call(await receiptsRoute.POST(json("POST", { date: "2026-10-20", accountId: certificados, ...body })));

describe("recibo con varios medios y retenciones", () => {
  it("transferencia + cheque + retenciones suman lo aplicado; el cheque entra a la cartera y la retención a su cuenta", async () => {
    const { clientId, invoiceId } = await sale("0003-00000101", 1_000_000_00);
    const allocations = [{ invoiceId, amountCents: 1_000_000_00 }];
    const retentions = [{ type: "ganancias", amountCents: 20_000_00, certificateNumber: "G-1" }, { type: "iibb", jurisdiction: "Chaco", amountCents: 30_000_00 }];
    const lines = [
      { method: "transferencia", cashAccountId: accounts.nacion, amountCents: 700_000_00, reference: "TR-1" },
      { method: "cheque", cashAccountId: accounts.valores, amountCents: 250_000_00, check: { number: "C-77", bank: "Banco Galicia", dueDate: "2026-11-30", issuer: "Cliente SA" } },
    ];
    // Lo cobrado más las retenciones tiene que dar lo aplicado.
    expect((await collect({ clientId, allocations, retentions, lines: [lines[0]] })).body.error).toContain("tiene que dar");
    // El cheque recibido va a Valores al Cobro.
    expect((await collect({ clientId, allocations, retentions, lines: [lines[0], { ...lines[1], cashAccountId: accounts.nacion }] })).body.error).toContain("no sirve para cobrar con cheque");
    const created = await collect({ clientId, allocations, retentions, lines });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.receipt).toMatchObject({ amountCents: 1_000_000_00, method: "transferencia", cashAccountId: accounts.nacion });
    expect(created.body.receipt.retentions).toEqual([expect.objectContaining({ type: "ganancias", amountCents: 20_000_00, cashAccountId: accounts.retenciones }), expect.objectContaining({ type: "iibb", jurisdiction: "Chaco" })]);
    expect(created.body.pdf.retentions).toHaveLength(2);
    expect(await Invoice.findById(invoiceId).lean()).toMatchObject({ collectedCents: 1_000_000_00, status: "cobrada" });
    const check = await Check.findOne({ collectionId: created.body.receipt._id }).lean<{ _id: unknown }>();
    expect(check).toMatchObject({ direction: "recibido", status: "cartera", number: "C-77", amountCents: 250_000_00, issuer: "Cliente SA" });
    expect(String(created.body.receipt.lines[1].checkId)).toBe(String(check!._id));
    expect(await balance("valores")).toBe(250_000_00);
    expect(await balance("retenciones")).toBe(50_000_00);

    // Depositarlo: pase de Valores al Cobro al banco.
    const deposit = await call(await depositRoute.POST(json("POST", { date: "2026-11-30", bankAccountId: accounts.macro }), params({ id: String(check!._id) })));
    expect(deposit.status, JSON.stringify(deposit.body)).toBe(200);
    expect(deposit.body).toMatchObject({ status: "depositado", transferId: expect.any(String) });
    expect(await balance("valores")).toBe(0);
    expect(await balance("macro")).toBe(250_000_00);
    // Un recibo con su cheque ya depositado no se borra.
    Object.assign(session, { role: "gerencia", permissions: defaultPermissionsForRole("gerencia") });
    const removed = await call(await recordRoute.DELETE(new Request("http://test", { method: "DELETE" }), params({ entity: "collections", id: created.body.receipt._id })));
    expect(removed.body.error).toContain("no se borra");
    Object.assign(session, { role: "administracion", permissions: defaultPermissionsForRole("administracion") });
  });

  it("el cheque del recibo se endosa en una OP; editar el recibo no lo puede sacar", async () => {
    const { clientId, invoiceId } = await sale("0003-00000102", 80_000_00);
    const created = await collect({ clientId, allocations: [{ invoiceId, amountCents: 80_000_00 }], lines: [{ method: "echeq", cashAccountId: accounts.valores, amountCents: 80_000_00, check: { number: "E-5", bank: "Banco Nación", dueDate: "2026-11-15" } }] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const check = (await Check.findOne({ collectionId: created.body.receipt._id }).lean<{ _id: unknown; format: string }>())!;
    expect(check.format).toBe("echeq");

    const supplierId = String((await Supplier.create({ name: "Proveedor del endoso" }))._id);
    const f = await invoice(supplierId, "0009-00000001", 80_000_00);
    expect((await pay({ supplierId, allocations: [{ expenseId: f._id, amountCents: 80_000_00 }], lines: [{ method: "cheque_tercero", checkId: String(check._id), amountCents: 80_000_00 }] })).status).toBe(201);
    const edited = await call(await receiptRoute.PUT(json("PUT", { clientId, date: "2026-10-20", accountId: certificados, allocations: [{ invoiceId, amountCents: 80_000_00 }], lines: [{ method: "transferencia", cashAccountId: accounts.nacion, amountCents: 80_000_00 }] }), params({ id: created.body.receipt._id })));
    expect(edited.body.error).toContain("endosado");
  });

  it("el posnet entra a la cuenta de la tarjeta y, cuando acredita, pasa al banco", async () => {
    const { clientId, invoiceId } = await sale("0003-00000103", 40_000_00);
    expect((await collect({ clientId, allocations: [{ invoiceId, amountCents: 40_000_00 }], lines: [{ method: "tarjeta", cashAccountId: accounts.tarjeta, amountCents: 40_000_00 }] })).status).toBe(201);
    const before = (await balance("tarjeta"))!;
    const transfer = await call(await transferRoute.POST(json("POST", { date: "2026-11-10", from: accounts.tarjeta, to: accounts.nacion, amountCents: 40_000_00 })));
    expect(transfer.status).toBe(201);
    expect((await balance("tarjeta"))! - before).toBe(-40_000_00);
  });
});

describe("período de la factura y extracto por caja", () => {
  it("la factura toma el mes de su fecha si no se dice otro, y el libro IVA va por ese período", async () => {
    const supplierId = String((await Supplier.create({ name: "Proveedor del período" }))._id);
    // Recibida el 29/10 y cargada después: va a octubre.
    const october = await invoice(supplierId, "0011-00000001", 1_000_00, { issueDate: "2026-10-29", netCents: 826_45, vatPct: 21 });
    expect(october.period).toBe("2026-10");
    const forced = await invoice(supplierId, "0011-00000002", 2_000_00, { issueDate: "2026-10-30", period: "2026-11", netCents: 1_652_89, vatPct: 21 });
    expect(forced.period).toBe("2026-11");
    // Cambiar la fecha mueve el período que venía de la fecha; el puesto a mano queda.
    expect((await call(await recordRoute.PATCH(json("PATCH", { issueDate: "2026-09-15" }), params({ entity: "expenses", id: october._id })))).body.period).toBe("2026-09");
    expect((await call(await recordRoute.PATCH(json("PATCH", { issueDate: "2026-10-01" }), params({ entity: "expenses", id: forced._id })))).body.period).toBe("2026-11");

    const { ivaBook } = await import("../src/lib/accounting");
    const november = await ivaBook({ from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-30T23:59:59Z") });
    expect(november.purchases.map(row => row.number)).toContain("0011-00000002");
    const septiembre = await ivaBook({ from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T23:59:59Z") });
    expect(septiembre.purchases.map(row => row.number)).toEqual(["0011-00000001"]);
  });

  it("de un rango de códigos, con saldo anterior y final; un pago de dos facturas sale en dos filas con su período", async () => {
    await account("galicia", { code: 35, company: "tvp", type: "cuenta_corriente", openingBalanceCents: 500_000_00, openingDate: new Date("2026-09-01") });
    const supplierId = String((await Supplier.create({ name: "Proveedor del extracto" }))._id);
    const september = await invoice(supplierId, "0012-00000001", 100_000_00, { issueDate: "2026-09-20" });
    const october = await invoice(supplierId, "0012-00000002", 50_000_00, { issueDate: "2026-10-05" });
    // Antes del período: entra al saldo anterior.
    expect((await pay({ supplierId, date: "2026-10-10", allocations: [{ expenseId: september._id, amountCents: 30_000_00 }], lines: [{ method: "transferencia", cashAccountId: accounts.galicia, amountCents: 30_000_00, attachment: receipt }] })).status).toBe(201);
    expect((await pay({ supplierId, date: "2026-11-05", allocations: [{ expenseId: september._id, amountCents: 70_000_00 }, { expenseId: october._id, amountCents: 50_000_00 }], lines: [{ method: "transferencia", cashAccountId: accounts.galicia, amountCents: 120_000_00, reference: "TR-9", attachment: receipt }] })).status).toBe(201);

    const statementRoute = await import("../src/app/api/accounting/cash-statement/route");
    const result = await call(await statementRoute.GET(new Request("http://test/api/accounting/cash-statement?from=2026-11-01&to=2026-11-30&codeFrom=35&codeTo=35")));
    expect(result.status).toBe(200);
    expect(result.body.accounts).toHaveLength(1);
    const [galicia] = result.body.accounts;
    expect(galicia).toMatchObject({ code: 35, openingCents: 470_000_00, debitCents: 120_000_00, creditCents: 0, closingCents: 350_000_00 });
    expect(galicia.rows.map((row: { period: string; debitCents: number }) => [row.period, row.debitCents])).toEqual([["2026-09", 70_000_00], ["2026-10", 50_000_00]]);
    expect(galicia.rows[0]).toMatchObject({ concept: "CC - Materiales", detail: expect.stringContaining("Transferencia") });
  });
});

describe("proveedores y clientes con código", () => {
  it("el sistema les pone código y se encuentran por código, razón social, nombre de fantasía o CUIT", async () => {
    const created = await call(await recordsRoute.POST(json("POST", { name: "Junín Goma S.R.L.", tradeName: "Gomería Junín", cuit: "30623593829" }), params({ entity: "suppliers" })));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ code: expect.any(Number), tradeName: "Gomería Junín", cuit: "30-62359382-9" });
    const code = created.body.code as number;
    const next = await Supplier.create({ name: "Otro proveedor" });
    expect(next.code).toBe(code + 1);

    const search = async (text: string) => (await call(await recordsRoute.GET(new Request(`http://test/api/records/suppliers?search=${encodeURIComponent(text)}`), params({ entity: "suppliers" })))).body.items.map((item: { name: string }) => item.name);
    expect(await search(String(code))).toEqual(["Junín Goma S.R.L."]);
    expect(await search("gomería")).toEqual(["Junín Goma S.R.L."]);
    expect(await search("30623593829")).toEqual(["Junín Goma S.R.L."]);

    const { partyOption } = await import("../src/lib/parties");
    expect(partyOption(created.body)).toMatchObject({ code: String(code), label: `${code} · Junín Goma S.R.L.`, hint: "Gomería Junín · CUIT 30-62359382-9" });
  });

  it("el listado de TANGO completa por CUIT lo que falta y da de alta lo nuevo", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    await Supplier.create({ name: "Acusiel", cuit: "33-70874880-9" });
    const file = join(mkdtempSync(join(tmpdir(), "tango-")), "proveedores.csv");
    writeFileSync(file, "Código;Razón social;Nombre de fantasía;CUIT\n001;ACUSIEL;Acusiel Corrientes;33708748809\n002;PROKRETE ARGENTINA SA;Prokrete;30-69687437-5\n003;Sin CUIT;;\n");
    const run = (...args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/import-parties.ts", file, "--proveedores", ...args], { env: { ...process.env, MONGODB_URI: process.env.MONGODB_URI } });
    const dry = await run();
    expect(dry.stdout).toContain("1 nuevos, 1 para completar");
    expect(await Supplier.exists({ cuit: "30-69687437-5" })).toBeNull();
    await run("--apply");
    expect(await Supplier.findOne({ cuit: "33-70874880-9" }).lean()).toMatchObject({ name: "Acusiel", tradeName: "Acusiel Corrientes" });
    expect(await Supplier.findOne({ cuit: "30-69687437-5" }).lean()).toMatchObject({ name: "PROKRETE ARGENTINA SA", tradeName: "Prokrete", code: expect.any(Number) });
  }, 60_000);
});

describe("cheque propio diferido", () => {
  it("el día que el banco lo debita, el pase del banco a cheques diferidos lo deja cobrado y baja el banco", async () => {
    const supplierId = String((await Supplier.create({ name: "Proveedor del cheque" }))._id);
    const f = await invoice(supplierId, "0010-00000001", 90_000_00);
    const paid = await pay({ supplierId, allocations: [{ expenseId: f._id, amountCents: 90_000_00 }], lines: [{ method: "cheque", cashAccountId: accounts["chdif-macro"], amountCents: 90_000_00, attachment: receipt, check: { number: "3003", bank: "Banco Macro", dueDate: "2026-12-05" } }] });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const checkId = String(paid.body.payment.lines[0].checkId);
    const macro = (await balance("macro"))!;
    const deferred = (await balance("chdif-macro"))!;
    const debited = await call(await debitRoute.POST(json("POST", { date: "2026-12-05" }), params({ id: checkId })));
    expect(debited.status, JSON.stringify(debited.body)).toBe(200);
    expect(debited.body).toMatchObject({ status: "cobrado", transferId: expect.any(String) });
    expect((await balance("macro"))! - macro).toBe(-90_000_00);
    expect((await balance("chdif-macro"))! - deferred).toBe(90_000_00);
    expect(await CashMovement.findOne({ transferId: debited.body.transferId, direction: "egreso" }).lean()).toMatchObject({ description: expect.stringContaining("Transferencia de cheque diferido al banco") });
    // No se debita dos veces.
    expect((await call(await debitRoute.POST(json("POST", { date: "2026-12-06" }), params({ id: checkId })))).status).toBe(409);
  });
});
