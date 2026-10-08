import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole, type UserPermissions } from "../src/lib/permissions";
import type { Role } from "../src/lib/constants";

// La sesión cambia de persona en cada paso del circuito.
const session: { userId: string; name: string; email: string; role: Role; permissions: UserPermissions } = { userId: new Types.ObjectId().toHexString(), name: "Compras", email: "compras@test.local", role: "compras", permissions: defaultPermissionsForRole("compras") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { Account, CashAccount, Notification, Payment, Purchase, PurchaseReceipt, StockItem, Supplier, User } = await import("../src/lib/models");
const recordsRoute = await import("../src/app/api/records/[entity]/route");
const recordRoute = await import("../src/app/api/records/[entity]/[id]/route");
const emitRoute = await import("../src/app/api/purchases/[id]/emit/route");
const decisionRoute = await import("../src/app/api/purchases/[id]/decision/route");
const cancelRoute = await import("../src/app/api/purchases/[id]/cancel/route");
const paymentOrderRoute = await import("../src/app/api/purchases/[id]/payment-order/route");
const receiveRoute = await import("../src/app/api/purchases/[id]/receive/route");
const detailRoute = await import("../src/app/api/purchases/[id]/detail/route");
const notificationsRoute = await import("../src/app/api/notifications/route");

let server: MongoMemoryServer;
let uri = "";
let supplierId = "";
let materiales = "";
let banco = "";
const approverId = new Types.ObjectId();
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const json = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const action = async (route: { POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> }, id: string, body: unknown = {}) => call(await route.POST(json("POST", body), params({ id })));

function as(role: Role, name: string, extra: Partial<UserPermissions> = {}, userId = new Types.ObjectId().toHexString()) {
  Object.assign(session, { role, name, userId, permissions: { ...defaultPermissionsForRole(role), ...extra } });
}

async function newRequest(amountCents: number, extra: Record<string, unknown> = {}) {
  as("compras", "Compras");
  const created = await call(await recordsRoute.POST(json("POST", { company: "tvp", supplierId, description: "Membrana y selladores", amountCents, paymentTerms: "contado", requestedDate: "2026-10-08", ...extra }), params({ entity: "purchases" })));
  expect(created.status).toBe(201);
  return created.body as { _id: string; number: string; status: string };
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  uri = server.getUri("compras");
  process.env.MONGODB_URI = uri;
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
  const { ensureAccountCatalog } = await import("../src/lib/account-service");
  await ensureAccountCatalog();
  supplierId = String((await Supplier.create({ name: "Protex" }))._id);
  materiales = String((await Account.findOne({ name: "CC - Materiales" }).lean<{ _id: unknown }>())!._id);
  banco = String((await CashAccount.create({ company: "tvp", name: "Banco TVP", nameKey: "banco tvp", type: "cuenta_corriente" }))._id);
  // El Socio: administración, con el permiso de autorizar compras.
  await User.create({ _id: approverId, name: "Socio", email: "socio@test.local", role: "administracion", active: true, permissions: { ...defaultPermissionsForRole("administracion"), actions: ["approvePurchases"] } });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("solicitud de compra", () => {
  it("se numera SC, se edita en borrador y al emitirla por debajo del límite queda autorizada y en sólo lectura", async () => {
    const request = await newRequest(499_999_99);
    expect(request).toMatchObject({ number: "SC-1", status: "borrador" });
    // En borrador se cambia.
    expect((await call(await recordRoute.PATCH(json("PATCH", { description: "Membrana" }), params({ entity: "purchases", id: request._id })))).status).toBe(200);
    // Sin proveedor no se emite.
    const noSupplier = await newRequest(1_000_00, { supplierId: "" });
    expect((await action(emitRoute, noSupplier._id)).status).toBe(400);

    const emitted = await action(emitRoute, request._id);
    expect(emitted.status).toBe(200);
    expect(emitted.body).toMatchObject({ status: "autorizada", approval: { automatic: true } });
    // Pasa a Tesorería.
    expect(await Notification.exists({ dedupeKey: `purchase-treasury-${request._id}`, roles: "administracion" })).toBeTruthy();
    // Ya no se cambia ni se borra.
    const locked = await call(await recordRoute.PATCH(json("PATCH", { amountCents: 1_00 }), params({ entity: "purchases", id: request._id })));
    expect(locked.status).toBe(409);
    expect(locked.body.error).toContain("sólo lectura");
    as("gerencia", "Gerencia");
    expect((await call(await recordRoute.DELETE(new Request("http://test", { method: "DELETE" }), params({ entity: "purchases", id: request._id })))).status).toBe(409);
    expect((await action(emitRoute, request._id)).status).toBe(409);
  });

  it("desde $500.000 espera autorización: la da Gerencia o el Socio, Compras no; rechazar pide motivo", async () => {
    const request = await newRequest(500_000_00);
    expect((await action(emitRoute, request._id)).body.status).toBe("pendiente_autorizacion");
    // El aviso le llega a Gerencia y, por nombre, al Socio.
    const notice = await Notification.findOne({ dedupeKey: `purchase-approve-${request._id}` }).lean<{ roles: string[]; userIds: unknown[] }>();
    expect(notice!.roles).toContain("gerencia");
    expect(notice!.userIds.map(String)).toEqual([String(approverId)]);
    as("administracion", "Socio", { actions: ["approvePurchases"] }, String(approverId));
    const inbox = await call(await notificationsRoute.GET(new Request("http://test/api/notifications")));
    expect(inbox.body.items.some((item: { title: string }) => item.title.includes(request.number))).toBe(true);

    as("compras", "Compras");
    expect((await action(decisionRoute, request._id, { approve: true })).status).toBe(403);
    as("administracion", "Administración");
    expect((await action(decisionRoute, request._id, { approve: true })).status).toBe(403);

    as("administracion", "Socio", { actions: ["approvePurchases"] }, String(approverId));
    expect((await action(decisionRoute, request._id, { approve: false })).status).toBe(400);
    const approved = await action(decisionRoute, request._id, { approve: true });
    expect(approved.body).toMatchObject({ status: "autorizada", approval: { userName: "Socio" } });

    const other = await newRequest(900_000_00);
    await action(emitRoute, other._id);
    as("gerencia", "Gerencia");
    const rejected = await action(decisionRoute, other._id, { approve: false, reason: "Hay stock en el Salón" });
    expect(rejected.body).toMatchObject({ status: "rechazada", rejection: { reason: "Hay stock en el Salón" } });
    // Tesorería no le puede emitir OP a una rechazada.
    as("administracion", "Tesorería");
    expect((await action(paymentOrderRoute, other._id, { amountCents: 1_00, date: "2026-10-08", method: "transferencia", accountId: materiales })).status).toBe(409);
  });
});

describe("la orden de pago genera la orden de compra", () => {
  it("Tesorería emite la OP, nace la OC; varias OP parciales suman a la misma OC y no pasan del total", async () => {
    const request = await newRequest(300_000_00, { paymentTerms: "cuenta_corriente" });
    await action(emitRoute, request._id);

    // Compras no emite OP, aunque tenga permisos guardados de antes que se lo daban.
    as("compras", "Compras", { edit: [...defaultPermissionsForRole("compras").edit, "payments"] });
    expect((await action(paymentOrderRoute, request._id, { amountCents: 100_000_00, date: "2026-10-08", method: "transferencia", accountId: materiales })).status).toBe(403);
    expect((await call(await recordsRoute.POST(json("POST", { supplierId, date: "2026-10-08", amountCents: 1_00, method: "efectivo", accountId: materiales, status: "emitida" }), params({ entity: "payments" })))).status).toBe(403);

    as("administracion", "Tesorería");
    // Anticipo de contado: pagada ya, desde el banco, con comprobante.
    const advance = await action(paymentOrderRoute, request._id, { amountCents: 100_000_00, date: "2026-10-08", method: "transferencia", accountId: materiales, cashAccountId: banco, execute: true, attachment: "/api/uploads/comprobante.pdf" });
    expect(advance.status).toBe(201);
    expect(advance.body.order).toMatchObject({ number: "OC-1", stage: "orden", status: "emitida", requestId: request._id, paymentTerms: "cuenta_corriente", paidCents: 100_000_00, paymentStatus: "parcial" });
    expect(advance.body.payment).toMatchObject({ number: "OP-1", status: "pagada", purchaseId: advance.body.order._id, cashAccountId: banco, attachment: "/api/uploads/comprobante.pdf", paidByName: "Tesorería" });
    expect((await Purchase.findById(request._id).lean<{ orderId: unknown }>())!.orderId).toEqual(new Types.ObjectId(advance.body.order._id));
    // Compras se entera, con link a la OC.
    expect(await Notification.exists({ roles: "compras", href: `/app/purchases?ver=${advance.body.order._id}` })).toBeTruthy();

    // El resto queda emitido, con vencimiento a 30 días por ser cuenta corriente. Desde la solicitud cae en la misma OC.
    const rest = await action(paymentOrderRoute, request._id, { amountCents: 200_000_00, date: "2026-10-08", method: "transferencia", accountId: materiales });
    expect(rest.status).toBe(201);
    expect(rest.body.order.number).toBe("OC-1");
    expect(rest.body.payment).toMatchObject({ status: "emitida", dueDate: "2026-11-07T00:00:00.000Z" });
    expect(await Purchase.countDocuments({ requestId: request._id })).toBe(1);
    // Ya no queda nada sin orden de pago.
    expect((await action(paymentOrderRoute, advance.body.order._id, { amountCents: 1_000_00, date: "2026-10-08", method: "transferencia", accountId: materiales })).status).toBe(409);

    // Se paga la segunda: la OC queda pagada.
    const paid = await call(await recordRoute.PATCH(json("PATCH", { status: "pagada", cashAccountId: banco }), params({ entity: "payments", id: rest.body.payment._id })));
    expect(paid.status).toBe(200);
    expect(await Purchase.findById(advance.body.order._id).lean()).toMatchObject({ paidCents: 300_000_00, paymentStatus: "pagada" });

    // La ficha muestra todo junto.
    as("compras", "Compras");
    const detail = await call(await detailRoute.GET(new Request("http://test"), params({ id: request._id })));
    expect(detail.body).toMatchObject({ request: { number: request.number }, order: { number: "OC-1" }, totals: { totalCents: 300_000_00, paidCents: 300_000_00, pendingCents: 0 } });
    expect(detail.body.payments).toHaveLength(2);
    expect(detail.body.can).toMatchObject({ paymentOrder: false, receive: true, cancel: false });
  });
});

describe("remitos del proveedor", () => {
  it("la recepción parcial suma al stock, el remito final cierra la orden y después no entra más", async () => {
    as("compras", "Compras");
    const created = await Purchase.create({
      number: "SC-90", company: "constructora", supplierId, description: "Pegamento", amountCents: 121_000_00, stage: "solicitud", status: "borrador", requestedDate: new Date(), deliverTo: "central",
      items: [{ code: "PEG-20", name: "Pegatex porcelanato", presentation: "Bolsa 20 KG", quantity: 10, listPriceCents: 10_000_00, discountPct: 0, unitCents: 10_000_00, totalCents: 100_000_00 }],
    });
    await action(emitRoute, String(created._id));
    // Sin OC todavía no se recibe.
    expect((await action(receiveRoute, String(created._id), { lines: [{ line: 0, quantity: 1 }] })).status).toBe(409);
    as("administracion", "Tesorería");
    const op = await action(paymentOrderRoute, String(created._id), { amountCents: 121_000_00, date: "2026-10-08", method: "efectivo", accountId: materiales });
    const orderId = op.body.order._id as string;

    as("compras", "Compras");
    // No llega más de lo pedido.
    expect((await action(receiveRoute, orderId, { lines: [{ line: 0, quantity: 11 }] })).status).toBe(400);
    const partial = await action(receiveRoute, orderId, { supplierRemito: "0001-00000045", date: "2026-10-09", lines: [{ line: 0, quantity: 4 }], status: "observada", notes: "Una bolsa rota" });
    expect(partial.status).toBe(201);
    expect(partial.body.order).toMatchObject({ status: "emitida", receptionStatus: "parcial", items: [{ receivedQty: 4 }] });
    const stock = await StockItem.findOne({ sku: "PEG-20" }).lean<Record<string, unknown>>();
    expect(stock).toMatchObject({ qty_central: 4, owners: { central: { constructora: 4 } } });
    // La observada avisa.
    expect(await Notification.exists({ title: { $regex: "Remito observado" } })).toBeTruthy();

    const rest = await action(receiveRoute, orderId, { supplierRemito: "0001-00000051", date: "2026-10-12" });
    expect(rest.body.order).toMatchObject({ status: "cerrada", receptionStatus: "recibida", items: [{ receivedQty: 10 }] });
    expect(rest.body.receipt).toMatchObject({ final: true, lines: [{ quantity: 6 }] });
    expect(await PurchaseReceipt.countDocuments({ purchaseId: orderId })).toBe(2);
    expect((await StockItem.findOne({ sku: "PEG-20" }).lean<Record<string, number>>())!.qty_central).toBe(10);
    expect((await action(receiveRoute, orderId, { lines: [{ line: 0, quantity: 1 }] })).status).toBe(409);
  });
});

describe("anulación y facturas de compra", () => {
  it("sólo Gerencia anula, con motivo; no lo que ya tiene pagos; las OP emitidas caen con la orden", async () => {
    const request = await newRequest(50_000_00);
    await action(emitRoute, request._id);
    as("administracion", "Tesorería");
    const op = await action(paymentOrderRoute, request._id, { amountCents: 50_000_00, date: "2026-10-08", method: "transferencia", accountId: materiales });

    as("compras", "Compras");
    expect((await action(cancelRoute, request._id, { reason: "Ya no hace falta" })).status).toBe(403);
    as("gerencia", "Gerencia");
    expect((await action(cancelRoute, request._id, { reason: "x" })).status).toBe(400);
    const cancelled = await action(cancelRoute, request._id, { reason: "El cliente suspendió la obra" });
    expect(cancelled.status).toBe(200);
    expect(await Purchase.findById(request._id).lean()).toMatchObject({ status: "anulada", cancellation: { reason: "El cliente suspendió la obra", userName: "Gerencia" } });
    expect(await Purchase.findById(op.body.order._id).lean()).toMatchObject({ status: "anulada" });
    expect(await Payment.findById(op.body.payment._id).lean()).toMatchObject({ status: "anulada" });

    // Una con pagos hechos no se anula.
    const paidOne = await newRequest(10_000_00);
    await action(emitRoute, paidOne._id);
    as("administracion", "Tesorería");
    await action(paymentOrderRoute, paidOne._id, { amountCents: 10_000_00, date: "2026-10-08", method: "transferencia", accountId: materiales, cashAccountId: banco, execute: true });
    as("gerencia", "Gerencia");
    expect((await action(cancelRoute, paidOne._id, { reason: "Error de carga" })).status).toBe(409);
  });

  it("Compras carga facturas de compras menores al límite; desde el límite, Tesorería", async () => {
    as("compras", "Compras");
    const small = await Purchase.create({ number: "OC-500", stage: "orden", status: "emitida", company: "tvp", supplierId, description: "Chico", amountCents: 100_000_00, requestedDate: new Date() });
    const big = await Purchase.create({ number: "OC-501", stage: "orden", status: "emitida", company: "tvp", supplierId, description: "Grande", amountCents: 800_000_00, requestedDate: new Date() });
    const invoice = async (purchaseId: string, number: string) => call(await recordsRoute.POST(json("POST", { purchaseId, voucherType: "factura_a", number, description: "Factura", category: "materiales", netCents: 1_000_00, vatPct: 21, amountCents: 1_210_00, issueDate: "2026-10-08", status: "pendiente" }), params({ entity: "expenses" })));
    expect((await invoice(String(small._id), "0001-00000001")).status).toBe(201);
    const blocked = await invoice(String(big._id), "0001-00000002");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toContain("Tesorería");
    as("administracion", "Tesorería");
    expect((await invoice(String(big._id), "0001-00000002")).status).toBe(201);
  });
});

describe("migración de las compras de antes", () => {
  it("renumera las solicitudes, pasa los estados y ata las OP a su OC", async () => {
    const db = mongoose.connection;
    const supplier = new Types.ObjectId(supplierId);
    const { insertedIds } = await db.collection("purchases").insertMany([
      { number: "OC-700", stage: "solicitud", status: "aprobada", description: "Vieja", amountCents: 1, requestedDate: new Date(), createdAt: new Date("2026-01-01") },
      { number: "OC-701", stage: "orden", status: "enviada", description: "Vieja orden", amountCents: 1_000_00, supplierId: supplier, requestedDate: new Date() },
      { number: "OC-702", stage: "recepcion", status: "recibida", description: "Vieja recibida", amountCents: 1, requestedDate: new Date(), items: [{ name: "Cal", quantity: 3, unitCents: 1, totalCents: 3 }] },
    ]);
    const expense = await db.collection("expenses").insertOne({ purchaseId: insertedIds[1], description: "Factura vieja", category: "materiales", amountCents: 1_000_00, issueDate: new Date(), status: "pagado" });
    await db.collection("payments").insertOne({ expenseId: expense.insertedId, date: new Date(), amountCents: 1_000_00, method: "efectivo", status: "pagada" });

    const run = (...args: string[]) => promisify(execFile)(process.execPath, ["scripts/migrate-purchases.mjs", ...args], { env: { ...process.env, MONGODB_URI: uri } });
    const dry = await run();
    expect(dry.stdout).toContain("Modo prueba");
    expect(await db.collection("purchases").findOne({ _id: insertedIds[0] })).toMatchObject({ number: "OC-700" });

    await run("--apply");
    const request = await db.collection("purchases").findOne({ _id: insertedIds[0] });
    expect(request).toMatchObject({ legacyNumber: "OC-700", status: "autorizada" });
    expect(String(request!.number)).toMatch(/^SC-\d+$/);
    expect(await db.collection("purchases").findOne({ _id: insertedIds[1] })).toMatchObject({ stage: "orden", status: "emitida", paidCents: 1_000_00, paymentStatus: "pagada" });
    expect(await db.collection("purchases").findOne({ _id: insertedIds[2] })).toMatchObject({ stage: "orden", status: "cerrada", receptionStatus: "recibida", items: [{ receivedQty: 3 }] });
    expect(await db.collection("payments").findOne({ expenseId: expense.insertedId })).toMatchObject({ purchaseId: insertedIds[1] });
    // La próxima solicitud sigue después de las migradas.
    const next = await newRequest(1_00);
    expect(Number(next.number.slice(3))).toBeGreaterThan(Number(String(request!.number).slice(3)));
  }, 60_000);
});
