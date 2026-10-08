import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole, type UserPermissions } from "../src/lib/permissions";
import type { Role } from "../src/lib/constants";

const session: { userId: string; name: string; email: string; role: Role; permissions: UserPermissions } = { userId: new Types.ObjectId().toHexString(), name: "Tesorería", email: "tesoreria@test.local", role: "administracion", permissions: defaultPermissionsForRole("administracion") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { Account, Expense, Payment, Purchase, Supplier } = await import("../src/lib/models");
const filesRoute = await import("../src/app/api/files/[entity]/[id]/route");
const documentRoute = await import("../src/app/api/payments/[id]/document/route");
const { buildPaymentOrderPdf } = await import("../src/lib/payment-order-pdf");

let server: MongoMemoryServer;
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const json = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("adjuntos");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
  const { ensureAccountCatalog } = await import("../src/lib/account-service");
  await ensureAccountCatalog();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("adjuntos con historial", () => {
  it("suma archivos con nombre, usuario y fecha; reemplazar no borra, queda en el historial", async () => {
    const payment = await Payment.create({ number: "OP-50", date: new Date(), amountCents: 1_000_00, method: "efectivo", status: "pagada", attachment: "/api/uploads/viejo.pdf" });
    const id = String(payment._id);
    // El archivo único de antes aparece como el primero.
    const listed = await call(await filesRoute.GET(new Request("http://test"), params({ entity: "payments", id })));
    expect(listed.body.items).toEqual([expect.objectContaining({ path: "/api/uploads/viejo.pdf", legacy: true })]);

    const added = await call(await filesRoute.POST(json("POST", { path: "/api/uploads/constancia.jpg", name: "Constancia firmada.jpg", size: 1234, label: "Constancia de entrega" }), params({ entity: "payments", id })));
    expect(added.status).toBe(201);
    expect(added.body.items[1]).toMatchObject({ path: "/api/uploads/constancia.jpg", name: "Constancia firmada.jpg", label: "Constancia de entrega", uploadedByName: "Tesorería" });

    // Reemplazar el de antes: pasa al historial como reemplazado.
    const replacedLegacy = await call(await filesRoute.POST(json("POST", { path: "/api/uploads/nuevo.pdf", name: "Transferencia.pdf", replaces: "legacy" }), params({ entity: "payments", id })));
    expect(replacedLegacy.body.items.find((file: { path: string }) => file.path === "/api/uploads/viejo.pdf")).toMatchObject({ replacedByName: "Tesorería" });
    expect(await Payment.findById(id).lean()).not.toHaveProperty("attachment");

    // Reemplazar uno nuevo; el mismo no se reemplaza dos veces.
    const constancia = added.body.items[1]._id;
    const replaced = await call(await filesRoute.POST(json("POST", { path: "/api/uploads/constancia2.jpg", name: "Constancia bien.jpg", replaces: constancia }), params({ entity: "payments", id })));
    expect(replaced.body.items.filter((file: { replacedAt?: string }) => !file.replacedAt).map((file: { name: string }) => file.name)).toEqual(["Transferencia.pdf", "Constancia bien.jpg"]);
    expect((await call(await filesRoute.POST(json("POST", { path: "/api/uploads/otro.jpg", replaces: constancia }), params({ entity: "payments", id })))).status).toBe(409);
    // Sólo archivos subidos al sistema.
    expect((await call(await filesRoute.POST(json("POST", { path: "https://otro.sitio/archivo.pdf" }), params({ entity: "payments", id })))).status).toBe(400);
  });

  it("cada documento con su permiso: Compras no adjunta a una orden de pago, sí a una compra", async () => {
    const payment = await Payment.create({ number: "OP-51", date: new Date(), amountCents: 1, method: "transferencia", status: "emitida" });
    const purchase = await Purchase.create({ number: "SC-51", description: "Algo", amountCents: 1, requestedDate: new Date() });
    session.role = "compras"; session.permissions = defaultPermissionsForRole("compras");
    expect((await call(await filesRoute.POST(json("POST", { path: "/api/uploads/x.pdf" }), params({ entity: "payments", id: String(payment._id) })))).status).toBe(403);
    expect((await call(await filesRoute.POST(json("POST", { path: "/api/uploads/presupuesto.pdf", name: "Presupuesto del proveedor.pdf" }), params({ entity: "purchases", id: String(purchase._id) })))).status).toBe(201);
    expect((await call(await filesRoute.GET(new Request("http://test"), params({ entity: "otra-cosa", id: String(purchase._id) })))).status).toBe(404);
    session.role = "administracion"; session.permissions = defaultPermissionsForRole("administracion");
  });
});

describe("orden de pago en PDF", () => {
  it("trae proveedor, orden, solicitud, factura y cuentas; en efectivo lleva la constancia para firmar", async () => {
    const supplier = await Supplier.create({ name: "Corralón Norte", cuit: "30-55555555-5" });
    const request = await Purchase.create({ number: "SC-60", description: "Arena", amountCents: 1, requestedDate: new Date() });
    const order = await Purchase.create({ number: "OC-60", stage: "orden", status: "emitida", description: "Arena", amountCents: 1, requestedDate: new Date(), requestId: request._id });
    const expense = await Expense.create({ number: "0002-00000077", voucherType: "factura_a", description: "Arena", category: "materiales", amountCents: 121_000_00, issueDate: new Date() });
    const account = await Account.findOne({ name: "CC - Materiales" }).lean<{ _id: unknown }>();
    const payment = await Payment.create({ number: "OP-60", company: "constructora", supplierId: supplier._id, purchaseId: order._id, requestId: request._id, expenseId: expense._id, date: new Date("2026-10-08"), amountCents: 121_000_00, retentionsCents: 1_000_00, method: "efectivo", account: "Caja pesos", accountId: account!._id, status: "pagada", paidAt: new Date(), paidByName: "Tesorería" });

    const data = await call(await documentRoute.GET(new Request("http://test"), params({ id: String(payment._id) })));
    expect(data.body).toMatchObject({ company: "constructora", number: "OP-60", supplier: { name: "Corralón Norte", cuit: "30-55555555-5" }, orderNumber: "OC-60", requestNumber: "SC-60", invoiceLabel: "Factura A 0002-00000077", cashAccount: "Caja pesos", ledgerAccount: "CC - Materiales", retentionsCents: 1_000_00, paidByName: "Tesorería" });

    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    expect(buildPaymentOrderPdf(doc, data.body, { author: "Tesorería" })).toBe("orden-de-pago-OP-60.pdf");
    const text = doc.output();
    expect(text).toContain("Recib");
    expect(text).toContain("OC-60");
  });
});
