import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { viewSections, type ViewSection } from "../src/lib/constants";

vi.mock("@/lib/auth", () => ({ requireSession: async () => ({ userId: "000000000000000000000001", name: "Gerencia", email: "g@test.local", role: "gerencia" }), getSession: async () => null, isOwnerEmail: () => false }));

/*
 * El historial del hilo de documentos (docs/plan-historial-de-documentos.md):
 * desde cualquier comprobante se ven los demás del hilo, en orden de fecha, en
 * los dos sentidos, con lo que se asoció después y sólo lo que se puede leer.
 * Los documentos se cargan directo en la base: acá se prueba el recorrido.
 */

const { AuditLog, Collection, Expense, Invoice, Payment, Purchase, PurchaseReceipt, Quote, SalesRemito, Work } = await import("../src/lib/models");
const { documentThread } = await import("../src/lib/document-thread");
const threadRoute = await import("../src/app/api/thread/[kind]/[id]/route");

let server: MongoMemoryServer;
const id = () => new Types.ObjectId();
const day = (value: string) => new Date(`2026-11-${value}T12:00:00.000Z`);
const everything = { userId: id().toHexString(), name: "Gerencia", email: "g@test.local", role: "gerencia" as const };
function only(...view: ViewSection[]) {
  return { userId: id().toHexString(), name: "Compras", email: "c@test.local", role: "compras" as const, permissions: { view, edit: [], seen: [...viewSections] } };
}
const insert = (model: { collection: { insertOne: (doc: Record<string, unknown>) => Promise<unknown> } }, doc: Record<string, unknown>) => model.collection.insertOne({ createdAt: doc.createdAt || new Date(), ...doc });
const numbers = (thread: { nodes: Array<{ number: string }> }) => thread.nodes.map(node => node.number);

// Hilo de compras: COT-1 → OB-1 → SC-1 → OC-1 → R-1 → Factura A → OP-1.
const q1 = id(), w1 = id(), sc1 = id(), oc1 = id(), r1 = id(), e1 = id(), p1 = id(), other = id();
// Fuera de orden: la factura y la OP llegaron antes que la OC.
const oc2 = id(), e2 = id(), p2 = id(), sc3 = id();
// Ventas: COT-5 → remito → factura → recibo, con una nota de crédito.
const q5 = id(), sr5 = id(), i5 = id(), nc5 = id(), c5 = id();

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("hilo");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
  const clientId = id(), supplierId = id();

  await insert(Quote, { _id: q1, number: "COT-1", title: "Edificio Belgrano", clientId, amountCents: 1_000_000_00, status: "aprobada", workId: w1, createdAt: day("01") });
  await insert(Work, { _id: w1, code: "OB-1", name: "Edificio Belgrano", clientId, quoteId: q1, status: "en_curso", startDate: day("02") });
  await insert(Purchase, { _id: sc1, number: "SC-1", stage: "solicitud", status: "autorizada", description: "Membrana", amountCents: 121_000_00, requestedDate: day("03"), orderId: oc1, quoteId: q1, workId: w1, supplierId, userName: "Jorge" });
  await insert(Purchase, { _id: oc1, number: "OC-1", stage: "orden", status: "cerrada", description: "Membrana", amountCents: 121_000_00, requestedDate: day("03"), requestId: sc1, quoteId: q1, workId: w1, supplierId, approval: { userName: "Jorge", at: day("04") } });
  await insert(PurchaseReceipt, { _id: r1, number: "R-1", purchaseId: oc1, workId: w1, quoteId: q1, supplierId, date: day("05"), status: "conforme", userName: "Jorge" });
  await insert(Expense, { _id: e1, voucherType: "factura_a", number: "0004-00001520", supplierId, purchaseId: oc1, purchaseReceiptIds: [r1], workId: w1, quoteId: q1, description: "Membrana", category: "materiales", amountCents: 121_000_00, issueDate: day("06"), status: "pagado" });
  await AuditLog.create({ action: "create", entity: "expenses", entityId: e1, userName: "Fer", before: null, after: {} });
  await insert(Payment, { _id: p1, number: "OP-1", supplierId, allocations: [{ expenseId: e1, amountCents: 121_000_00 }], status: "pagada", method: "transferencia", amountCents: 121_000_00, date: day("09") });
  // Otro gasto de la misma obra, sin nada que ver con esta compra.
  await insert(Expense, { _id: other, voucherType: "factura_a", number: "0001-00000099", supplierId: id(), workId: w1, description: "Combustible", category: "combustible", amountCents: 50_000_00, issueDate: day("07"), status: "pendiente" });

  // La factura sin OC (10/11) y la OP a cuenta (11/11); la OC se hizo el 12/11 y se les asoció.
  await insert(Purchase, { _id: oc2, number: "OC-2", stage: "orden", status: "emitida", description: "Andamio", amountCents: 80_000_00, requestedDate: day("12"), supplierId, createdAt: day("12") });
  await insert(Expense, { _id: e2, voucherType: "factura_a", number: "0004-00001600", supplierId, purchaseId: oc2, description: "Andamio", category: "materiales", amountCents: 80_000_00, issueDate: day("10"), status: "pagado" });
  await AuditLog.create({ action: "associate", entity: "expenses", entityId: e2, userName: "Fer", before: { purchaseId: null }, after: { purchaseId: oc2 } });
  await insert(Payment, { _id: p2, number: "OP-2", supplierId, allocations: [{ expenseId: e2, amountCents: 80_000_00 }], status: "pagada", method: "efectivo", amountCents: 80_000_00, date: day("11") });
  await AuditLog.create({ action: "update", entity: "payments", entityId: p2, userName: "Fer", before: { onAccountCents: 80_000_00 }, after: { allocations: [{ expenseId: e2, amountCents: 80_000_00 }] } });
  // Una corrección vieja, que sólo dejó el texto en el historial.
  await insert(Purchase, { _id: sc3, number: "SC-3", stage: "solicitud", status: "borrador", description: "Andamio", amountCents: 80_000_00, requestedDate: day("13"), history: [{ action: "Corrige la OC-2, anulada", at: day("13"), userName: "Jorge" }] });

  await insert(Quote, { _id: q5, number: "COT-5", title: "Pintura", clientId, amountCents: 500_000_00, status: "aprobada", createdAt: day("01") });
  await insert(SalesRemito, { _id: sr5, number: "RV-1", clientId, quoteId: q5, date: day("02"), status: "facturado", invoiceIds: [i5], totalCents: 300_000_00 });
  await insert(Invoice, { _id: i5, voucherType: "factura_a", number: "0003-00000010", clientId, quoteId: q5, remitoIds: [sr5], issueDate: day("03"), amountCents: 300_000_00, status: "cobrada" });
  await insert(Invoice, { _id: nc5, voucherType: "nota_credito_a", number: "0003-00000011", clientId, associatedInvoiceId: i5, issueDate: day("04"), amountCents: 10_000_00, status: "aplicada" });
  await insert(Collection, { _id: c5, number: "RC-1", clientId, allocations: [{ invoiceId: i5, amountCents: 290_000_00 }], date: day("05"), amountCents: 290_000_00, method: "transferencia" });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("historial del hilo de documentos", () => {
  it("desde la factura de compra se ve todo el hilo, de la cotización a la OP, en orden de fecha", async () => {
    const thread = await documentThread("expense", String(e1), everything);
    expect(numbers(thread)).toEqual(["COT-1", "OB-1", "SC-1", "OC-1", "R-1", "Factura A 0004-00001520", "OP-1"]);
    expect(thread.nodes.find(node => node.kind === "expense")).toMatchObject({ root: true, group: "compras", userName: "Fer" });
    expect(thread.nodes.map(node => node.group)).toEqual(["cotizacion", "cotizacion", "compras", "compras", "compras", "compras", "tesoreria"]);
    expect(thread.totals).toMatchObject({ quotedCents: 1_000_000_00, orderedCents: 121_000_00, billedPurchasesCents: 121_000_00, paidCents: 121_000_00 });
    expect(thread.nodes.find(node => node.kind === "purchase" && node.number === "OC-1")!.href).toBe(`/app/purchases?ver=${oc1}`);
  });

  it("desde la OP se llega hacia atrás a la misma compra", async () => {
    expect(numbers(await documentThread("payment", String(p1), everything))).toEqual(["COT-1", "OB-1", "SC-1", "OC-1", "R-1", "Factura A 0004-00001520", "OP-1"]);
  });

  it("desde un comprobante no se trae toda la obra; desde la obra, sí", async () => {
    expect(numbers(await documentThread("payment", String(p1), everything))).not.toContain("Factura A 0001-00000099");
    expect(numbers(await documentThread("work", String(w1), everything))).toContain("Factura A 0001-00000099");
  });

  it("lo cargado fuera de orden sale en su fecha, marcado como asociado después", async () => {
    const thread = await documentThread("purchase", String(oc2), everything);
    expect(numbers(thread)).toEqual(["Factura A 0004-00001600", "OP-2", "OC-2", "SC-3"]);
    const invoice = thread.nodes.find(node => node.kind === "expense")!;
    expect(invoice.events).toEqual([expect.objectContaining({ label: "Asociado a OC-2", userName: "Fer" })]);
    expect(thread.nodes.find(node => node.number === "OP-2")!.events).toEqual([expect.objectContaining({ label: "Asociado a Factura A 0004-00001600" })]);
    // La corrección de antes se encuentra por el texto del historial.
    expect(thread.nodes.find(node => node.number === "SC-3")!.events[0].label).toContain("Corrige la OC-2");
  });

  it("la compra corregida queda atada a la que la reemplaza con correctsId", async () => {
    const sc4 = id();
    await insert(Purchase, { _id: sc4, number: "SC-4", stage: "solicitud", status: "borrador", description: "Membrana", amountCents: 121_000_00, requestedDate: day("14"), correctsId: oc1 });
    expect(numbers(await documentThread("purchase", String(sc4), everything))).toContain("OC-1");
    expect(numbers(await documentThread("purchase", String(oc1), everything))).toContain("SC-4");
  });

  it("en ventas: cotización, remito, factura, nota de crédito y recibo", async () => {
    const thread = await documentThread("collection", String(c5), everything);
    expect(numbers(thread)).toEqual(["COT-5", "RV-1", "Factura A 0003-00000010", "Nota de Crédito A 0003-00000011", "RC-1"]);
    expect(thread.totals).toMatchObject({ billedSalesCents: 290_000_00, collectedCents: 290_000_00 });
  });

  it("sólo muestra lo que la persona puede leer y cuenta el resto por conjunto", async () => {
    const thread = await documentThread("purchase", String(oc1), only("purchases", "quotes"));
    expect(numbers(thread)).toEqual(["COT-1", "SC-1", "OC-1", "R-1", "SC-4"]);
    expect(thread.hidden).toEqual({ cotizacion: 1, compras: 1 });
    await expect(documentThread("payment", String(p1), only("purchases"))).rejects.toMatchObject({ status: 403 });
  });

  it("la API responde el hilo y rechaza un tipo desconocido", async () => {
    const ok = await threadRoute.GET(new Request("http://test"), { params: Promise.resolve({ kind: "invoice", id: String(i5) }) });
    expect(ok.status).toBe(200);
    expect(numbers(await ok.json())).toContain("RC-1");
    const bad = await threadRoute.GET(new Request("http://test"), { params: Promise.resolve({ kind: "cheque", id: String(i5) }) });
    expect(bad.status).toBe(404);
  });
});
