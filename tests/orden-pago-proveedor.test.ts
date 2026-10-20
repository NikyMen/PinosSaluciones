import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole, type UserPermissions } from "../src/lib/permissions";
import type { Role } from "../src/lib/constants";

// Tesorería: la OP que paga varias facturas del proveedor, total o parcial, y descuenta notas de crédito.
const session: { userId: string; name: string; email: string; role: Role; permissions: UserPermissions } = { userId: new Types.ObjectId().toHexString(), name: "Tesorería", email: "tesoreria@test.local", role: "administracion", permissions: defaultPermissionsForRole("administracion") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { Account, CashAccount, Check, Client, Expense, Purchase, Supplier, Work } = await import("../src/lib/models");
const recordsRoute = await import("../src/app/api/records/[entity]/route");
const recordRoute = await import("../src/app/api/records/[entity]/[id]/route");
const ordersRoute = await import("../src/app/api/payment-orders/route");
const orderRoute = await import("../src/app/api/payment-orders/[id]/route");
const emitRoute = await import("../src/app/api/purchases/[id]/emit/route");
const purchasePaymentRoute = await import("../src/app/api/purchases/[id]/payment-order/route");

let server: MongoMemoryServer;
let supplierId = "";
let otherSupplierId = "";
let materiales = "";
let libreria = "";
let bienesDeUso = "";
let banco = "";
let bancoConstructora = "";
let workId = "";
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const json = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function as(role: Role, name: string) {
  Object.assign(session, { role, name, permissions: defaultPermissionsForRole(role) });
}

async function voucher(body: Record<string, unknown>) {
  const created = await call(await recordsRoute.POST(json("POST", { company: "tvp", supplierId, voucherType: "factura_a", description: "Materiales", category: "materiales", issueDate: "2026-10-01", status: "pendiente", ...body }), params({ entity: "expenses" })));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body as { _id: string };
}

const pending = async (supplier = supplierId, payment?: string) => {
  const result = await call(await ordersRoute.GET(new Request(`http://test/api/payment-orders?${new URLSearchParams({ supplierId: supplier, ...(payment ? { payment } : {}) }).toString()}`)));
  expect(result.status).toBe(200);
  return result.body.items as Array<{ _id: string; credit: boolean; balanceCents: number; committedCents: number; appliedCents: number; notice: string }>;
};
const pay = async (body: Record<string, unknown>) => call(await ordersRoute.POST(json("POST", { supplierId, date: "2026-10-15", method: "transferencia", accountId: materiales, cashAccountId: banco, execute: true, ...body })));
const expense = async (id: string) => (await Expense.findById(id).lean<{ paidCents: number; status: string; advanceCents?: number }>())!;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("orden-pago");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
  const { ensureAccountCatalog } = await import("../src/lib/account-service");
  await ensureAccountCatalog();
  supplierId = String((await Supplier.create({ name: "Higienista" }))._id);
  otherSupplierId = String((await Supplier.create({ name: "Corralón" }))._id);
  materiales = String((await Account.findOne({ name: "CC - Materiales" }).lean<{ _id: unknown }>())!._id);
  libreria = String((await Account.findOne({ name: "GGI - Librería" }).lean<{ _id: unknown }>())!._id);
  bienesDeUso = String((await Account.findOne({ name: "BB - Compras de Bienes de Uso" }).lean<{ _id: unknown }>())!._id);
  banco = String((await CashAccount.create({ company: "tvp", name: "Banco Corrientes TVP", nameKey: "banco corrientes tvp", type: "cuenta_corriente" }))._id);
  bancoConstructora = String((await CashAccount.create({ company: "constructora", name: "Banco Constructora", nameKey: "banco constructora", type: "cuenta_corriente" }))._id);
  const clientId = (await Client.create({ name: "Consorcio Belgrano" }))._id;
  workId = String((await Work.create({ name: "Edificio Belgrano", code: "OB-1", clientId, status: "en_curso" }))._id);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("orden de pago de varias facturas", () => {
  it("paga una factura entera y otra en parte, descuenta la nota de crédito y lo que queda vuelve a aparecer", async () => {
    as("administracion", "Tesorería");
    const f1 = await voucher({ number: "0001-00000001", amountCents: 100_000_00 });
    const f2 = await voucher({ number: "0001-00000002", amountCents: 80_000_00, issueDate: "2026-10-05" });
    const f3 = await voucher({ number: "0001-00000003", amountCents: 50_000_00, issueDate: "2026-10-06" });
    // Tesorería: "me facturó honorarios de tres obras y fue una": se pide la nota de crédito.
    const nc = await voucher({ voucherType: "nota_credito_a", number: "0001-00000004", amountCents: 30_000_00, associatedExpenseId: f2._id, issueDate: "2026-10-07" });

    const list = await pending();
    expect(list.map(item => item._id)).toEqual([f1._id, f2._id, f3._id, nc._id]);
    expect(list.find(item => item._id === nc._id)).toMatchObject({ credit: true, balanceCents: 30_000_00 });

    // La factura 1 entera, 50.000 de la 2, la 3 no; la nota de crédito resta.
    const created = await pay({ allocations: [{ expenseId: f1._id, amountCents: 100_000_00 }, { expenseId: f2._id, amountCents: 50_000_00 }, { expenseId: nc._id, amountCents: 30_000_00 }], retentionsCents: 2_000_00, workId });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.payment).toMatchObject({ number: "OP-1", status: "pagada", amountCents: 120_000_00, retentionsCents: 2_000_00, expenseId: f1._id, workId, company: "tvp" });
    expect(created.body.pdf.lines).toEqual([
      expect.objectContaining({ label: "Factura A 0001-00000001", appliedCents: 100_000_00, credit: false }),
      expect.objectContaining({ label: "Factura A 0001-00000002", totalCents: 80_000_00, appliedCents: 50_000_00, credit: false }),
      expect.objectContaining({ label: "Nota de Crédito A 0001-00000004", appliedCents: 30_000_00, credit: true }),
    ]);

    expect(await expense(f1._id)).toMatchObject({ paidCents: 100_000_00, status: "pagado" });
    expect(await expense(f2._id)).toMatchObject({ paidCents: 50_000_00, status: "parcial" });
    expect(await expense(f3._id)).toMatchObject({ paidCents: 0, status: "pendiente" });
    expect(await expense(nc._id)).toMatchObject({ paidCents: 30_000_00, status: "pagado" });

    // En la próxima OP: la factura 2 con lo que le queda y la 3.
    const next = await pending();
    expect(next.map(item => [item._id, item.balanceCents])).toEqual([[f2._id, 30_000_00], [f3._id, 50_000_00]]);

    // Del banco salió lo neto de retenciones.
    const { cashAccountBalances } = await import("../src/lib/cash-accounts");
    const balances = await cashAccountBalances([(await CashAccount.findById(banco).lean())!] as never);
    expect(balances.get(banco)).toBe(-118_000_00);

    // Editarla: deshace lo aplicado y aplica lo nuevo (ahora la factura 2 entera, sin la nota).
    const edited = await call(await orderRoute.PUT(json("PUT", { supplierId, date: "2026-10-15", method: "transferencia", accountId: materiales, cashAccountId: banco, execute: true, workId, allocations: [{ expenseId: f1._id, amountCents: 100_000_00 }, { expenseId: f2._id, amountCents: 80_000_00 }] }), params({ id: created.body.payment._id })));
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.payment).toMatchObject({ amountCents: 180_000_00 });
    expect(await expense(f2._id)).toMatchObject({ paidCents: 80_000_00, status: "pagado" });
    expect(await expense(nc._id)).toMatchObject({ paidCents: 0, status: "pendiente" });

    // Borrarla (sólo Gerencia) devuelve los saldos.
    as("gerencia", "Gerencia");
    expect((await call(await recordRoute.DELETE(new Request("http://test", { method: "DELETE" }), params({ entity: "payments", id: created.body.payment._id })))).status).toBe(200);
    expect(await expense(f1._id)).toMatchObject({ paidCents: 0, status: "pendiente" });
    expect(await expense(f2._id)).toMatchObject({ paidCents: 0, status: "pendiente" });
    as("administracion", "Tesorería");
  });

  it("no paga más que el saldo, ni descuenta más notas de crédito que lo que paga, ni mezcla empresas", async () => {
    as("administracion", "Tesorería");
    const supplier = String((await Supplier.create({ name: "Pinturería" }))._id);
    const a = await voucher({ supplierId: supplier, number: "0002-00000001", amountCents: 10_000_00 });
    const nc = await voucher({ supplierId: supplier, voucherType: "nota_credito_a", number: "0002-00000002", amountCents: 20_000_00 });
    const b = await voucher({ supplierId: supplier, company: "constructora", number: "0002-00000003", amountCents: 5_000_00 });

    const over = await pay({ supplierId: supplier, allocations: [{ expenseId: a._id, amountCents: 10_000_01 }] });
    expect(over.status).toBe(400);
    expect(over.body.error).toContain("le quedan");
    const creditOnly = await pay({ supplierId: supplier, allocations: [{ expenseId: nc._id, amountCents: 5_000_00 }] });
    expect(creditOnly.body.error).toContain("al menos una factura");
    const tooMuchCredit = await pay({ supplierId: supplier, allocations: [{ expenseId: a._id, amountCents: 10_000_00 }, { expenseId: nc._id, amountCents: 15_000_00 }] });
    expect(tooMuchCredit.body.error).toContain("notas de crédito");
    const mixed = await pay({ supplierId: supplier, allocations: [{ expenseId: a._id, amountCents: 10_000_00 }, { expenseId: b._id, amountCents: 5_000_00 }] });
    expect(mixed.body.error).toContain("una sola empresa");
    // Una factura de otro proveedor no entra.
    const foreign = await voucher({ supplierId: otherSupplierId, number: "0002-00000004", amountCents: 1_000_00 });
    expect((await pay({ supplierId: supplier, allocations: [{ expenseId: foreign._id, amountCents: 1_000_00 }] })).body.error).toContain("no es de este proveedor");
    // Una nota de crédito que lo cubre todo deja la OP en cero, y paga igual.
    const zero = await pay({ supplierId: supplier, allocations: [{ expenseId: a._id, amountCents: 10_000_00 }, { expenseId: nc._id, amountCents: 10_000_00 }] });
    expect(zero.status, JSON.stringify(zero.body)).toBe(201);
    expect(zero.body.payment.amountCents).toBe(0);
    expect(await expense(a._id)).toMatchObject({ status: "pagado" });
    expect(await expense(nc._id)).toMatchObject({ paidCents: 10_000_00, status: "parcial" });
    // La de la constructora se paga desde una cuenta suya.
    expect((await pay({ supplierId: supplier, allocations: [{ expenseId: b._id, amountCents: 5_000_00 }] })).body.error).toContain("Constructora");
    expect((await pay({ supplierId: supplier, cashAccountId: bancoConstructora, allocations: [{ expenseId: b._id, amountCents: 5_000_00 }] })).status).toBe(201);
  });

  it("una OP emitida reserva lo que va a pagar y descuenta recién cuando se paga; con e-Cheq queda el cheque", async () => {
    as("administracion", "Tesorería");
    const supplier = String((await Supplier.create({ name: "Andamios SA" }))._id);
    const f = await voucher({ supplierId: supplier, number: "0003-00000001", amountCents: 40_000_00 });
    const emitted = await pay({ supplierId: supplier, execute: false, cashAccountId: "", dueDate: "2026-11-15", method: "echeq", allocations: [{ expenseId: f._id, amountCents: 25_000_00 }] });
    expect(emitted.status, JSON.stringify(emitted.body)).toBe(201);
    expect(emitted.body.payment).toMatchObject({ status: "emitida", method: "echeq" });
    expect(await expense(f._id)).toMatchObject({ paidCents: 0, status: "pendiente" });
    // No se puede volver a pagar lo que ya está en la OP emitida.
    expect((await pending(supplier))[0]).toMatchObject({ balanceCents: 15_000_00, committedCents: 25_000_00, notice: expect.stringContaining(emitted.body.payment.number) });
    expect((await pay({ supplierId: supplier, allocations: [{ expenseId: f._id, amountCents: 20_000_00 }] })).body.error).toContain("otra OP emitida");

    // Para pagarla con e-Cheq hacen falta sus datos.
    const body = { supplierId: supplier, date: "2026-10-20", method: "echeq", accountId: materiales, cashAccountId: banco, execute: true, allocations: [{ expenseId: f._id, amountCents: 25_000_00 }] };
    expect((await call(await orderRoute.PUT(json("PUT", body), params({ id: emitted.body.payment._id })))).body.error).toContain("cheque");
    const paid = await call(await orderRoute.PUT(json("PUT", { ...body, check: { number: "E-778", bank: "Banco de Corrientes", dueDate: "2026-11-20" } }), params({ id: emitted.body.payment._id })));
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.payment).toMatchObject({ status: "pagada", paidByName: "Tesorería" });
    expect(await expense(f._id)).toMatchObject({ paidCents: 25_000_00, status: "parcial" });
    const check = await Check.findById(paid.body.payment.checkId).lean();
    expect(check).toMatchObject({ direction: "emitido", status: "emitido", format: "echeq", number: "E-778", amountCents: 25_000_00 });
    expect(paid.body.pdf.check).toMatchObject({ number: "E-778", electronic: true });
  });
});

describe("tipo de gasto y obra", () => {
  it("un GGI o un bien de uso no va a una obra; CC puede ir con o sin obra", async () => {
    as("administracion", "Tesorería");
    const supplier = String((await Supplier.create({ name: "Librería del Centro" }))._id);
    const f = await voucher({ supplierId: supplier, number: "0004-00000001", amountCents: 3_000_00 });
    const ggi = await pay({ supplierId: supplier, accountId: libreria, workId, allocations: [{ expenseId: f._id, amountCents: 1_000_00 }] });
    expect(ggi.status).toBe(400);
    expect(ggi.body.error).toContain("no va a una obra");
    expect((await pay({ supplierId: supplier, accountId: bienesDeUso, workId, allocations: [{ expenseId: f._id, amountCents: 1_000_00 }] })).body.error).toContain("no va a una obra");
    expect((await pay({ supplierId: supplier, accountId: libreria, allocations: [{ expenseId: f._id, amountCents: 1_000_00 }] })).status).toBe(201);
    // CC sin obra: una compra para el depósito.
    expect((await pay({ supplierId: supplier, accountId: materiales, allocations: [{ expenseId: f._id, amountCents: 1_000_00 }] })).status).toBe(201);

    // La factura GGI tampoco lleva obra, y no la hereda de su OC.
    const blocked = await call(await recordsRoute.POST(json("POST", { company: "tvp", supplierId: supplier, voucherType: "factura_a", number: "0004-00000002", description: "Resmas", category: "gasto_fijo", accountId: libreria, workId, amountCents: 10_00, issueDate: "2026-10-01", status: "pendiente" }), params({ entity: "expenses" })));
    expect(blocked.status).toBe(400);
    const order = await Purchase.create({ number: "OC-900", stage: "orden", status: "emitida", company: "tvp", supplierId: supplier, workId, description: "Silla", amountCents: 50_00, requestedDate: new Date() });
    const inherited = await voucher({ supplierId: supplier, purchaseId: String(order._id), accountId: libreria, number: "0004-00000003", amountCents: 50_00 });
    expect((await Expense.findById(inherited._id).lean<{ workId?: unknown }>())!.workId).toBeUndefined();

    // La OP cargada a mano sigue la misma regla.
    const manual = await call(await recordsRoute.POST(json("POST", { company: "tvp", supplierId: supplier, date: "2026-10-15", amountCents: 1_00, method: "efectivo", accountId: libreria, workId, status: "emitida" }), params({ entity: "payments" })));
    expect(manual.body.error).toContain("no va a una obra");
  });
});

describe("el circuito de la hoja de Tesorería", () => {
  it("solicitud → OC al autorizar → remito → factura → OP de la factura, sin ninguna OP antes", async () => {
    as("compras", "Compras");
    const supplier = String((await Supplier.create({ name: "Corralón del Centro" }))._id);
    const request = await call(await recordsRoute.POST(json("POST", { company: "tvp", supplierId: supplier, description: "Cemento", amountCents: 60_000_00, paymentTerms: "cuenta_corriente", requestedDate: "2026-10-08" }), params({ entity: "purchases" })));
    const emitted = await call(await emitRoute.POST(json("POST", {}), params({ id: request.body._id })));
    expect(emitted.body).toMatchObject({ status: "autorizada" });
    const orderId = String(emitted.body.orderId);
    expect(await Purchase.findById(orderId).lean()).toMatchObject({ stage: "orden", status: "emitida", paymentStatus: "pendiente" });

    // Llega la factura con su remito y Tesorería la paga desde la orden de pago de facturas.
    as("administracion", "Tesorería");
    const invoice = await voucher({ supplierId: supplier, purchaseId: orderId, number: "0007-00000001", amountCents: 60_000_00, receiptRef: "R-0007-1" });
    expect(await expense(invoice._id)).toMatchObject({ paidCents: 0, status: "pendiente" });
    const paid = await pay({ supplierId: supplier, allocations: [{ expenseId: invoice._id, amountCents: 60_000_00 }] });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(paid.body.payment.purchaseId).toBe(orderId);
    expect(await Purchase.findById(orderId).lean()).toMatchObject({ paidCents: 60_000_00, paymentStatus: "pagada" });
  });
});

describe("compra de contado y su factura", () => {
  it("lo pagado contra la OC cubre la factura cuando llega: no aparece otra vez para pagar ni se cuenta dos veces", async () => {
    as("compras", "Compras");
    const supplier = String((await Supplier.create({ name: "Gomería del Norte" }))._id);
    const request = await call(await recordsRoute.POST(json("POST", { company: "tvp", supplierId: supplier, description: "Media sombra", amountCents: 120_000_00, paymentTerms: "contado", cashMethod: "efectivo", requestedDate: "2026-10-08" }), params({ entity: "purchases" })));
    expect(request.status).toBe(201);
    expect((await call(await emitRoute.POST(json("POST", {}), params({ id: request.body._id })))).status).toBe(200);

    as("administracion", "Tesorería");
    const advance = await call(await purchasePaymentRoute.POST(json("POST", { amountCents: 120_000_00, date: "2026-10-08", method: "transferencia", accountId: materiales, cashAccountId: banco, execute: true }), params({ id: request.body._id })));
    expect(advance.status, JSON.stringify(advance.body)).toBe(201);
    const orderId = advance.body.order._id;

    // Llega la factura con el remito: queda pagada por el anticipo.
    const invoice = await voucher({ supplierId: supplier, purchaseId: orderId, number: "0005-00000001", amountCents: 120_000_00, receiptRef: "R-0001-123" });
    expect(await expense(invoice._id)).toMatchObject({ paidCents: 120_000_00, advanceCents: 120_000_00, status: "pagado" });
    expect(await pending(supplier)).toEqual([]);
    expect(await Purchase.findById(orderId).lean()).toMatchObject({ paidCents: 120_000_00, paymentStatus: "pagada" });

    // Una nota de débito del flete: queda para pagar en una OP.
    const debit = await voucher({ supplierId: supplier, purchaseId: orderId, voucherType: "nota_debito_a", number: "0005-00000002", amountCents: 5_000_00, associatedExpenseId: invoice._id });
    expect((await pending(supplier)).map(item => [item._id, item.balanceCents])).toEqual([[debit._id, 5_000_00]]);
    expect((await pay({ supplierId: supplier, allocations: [{ expenseId: debit._id, amountCents: 5_000_00 }] })).status).toBe(201);
    expect(await Purchase.findById(orderId).lean()).toMatchObject({ paidCents: 125_000_00 });

    // Anular la factura libera el anticipo.
    expect((await call(await recordRoute.PATCH(json("PATCH", { status: "anulado" }), params({ entity: "expenses", id: invoice._id })))).status).toBe(200);
    expect(await expense(invoice._id)).toMatchObject({ advanceCents: 0, status: "anulado" });
  });

  it("una nota de débito o de crédito va con una factura del mismo proveedor y la misma letra", async () => {
    as("administracion", "Tesorería");
    const f = await voucher({ number: "0006-00000001", amountCents: 1_000_00 });
    const otherLetter = await call(await recordsRoute.POST(json("POST", { company: "tvp", supplierId, voucherType: "nota_credito_c", associatedExpenseId: f._id, number: "0006-00000002", description: "NC", category: "materiales", amountCents: 100_00, issueDate: "2026-10-01", status: "pendiente" }), params({ entity: "expenses" })));
    expect(otherLetter.status).toBe(400);
    expect(otherLetter.body.error).toContain("factura C del mismo proveedor");
  });
});

describe("libro IVA", () => {
  it("la nota de crédito del proveedor resta", async () => {
    const { ivaBook } = await import("../src/lib/accounting");
    const book = await ivaBook({ from: new Date("2026-10-01T00:00:00.000Z"), to: new Date("2026-10-31T23:59:59.000Z"), company: "tvp" });
    const note = book.purchases.find(row => row.number === "0001-00000004");
    expect(note?.totalCents).toBe(-30_000_00);
  });
});

