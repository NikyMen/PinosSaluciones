import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";

const session = { userId: new Types.ObjectId().toHexString(), name: "Administración", email: "admin@test.local", role: "gerencia" as const, permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { Account, CashMovement, Client, Collection, Expense, Invoice, Supplier, VoucherBook, Work } = await import("../src/lib/models");
const recordsRoute = await import("../src/app/api/records/[entity]/route");
const recordRoute = await import("../src/app/api/records/[entity]/[id]/route");
const receiptsRoute = await import("../src/app/api/receipts/route");
const transferRoute = await import("../src/app/api/cash/transfer/route");
const ivaRoute = await import("../src/app/api/accounting/iva/route");
const ledgerRoute = await import("../src/app/api/accounting/ledger/route");
const draftRoute = await import("../src/app/api/invoices/draft/route");
const booksRoute = await import("../src/app/api/voucher-books/route");
const bookRoute = await import("../src/app/api/voucher-books/[id]/route");

let server: MongoMemoryServer;
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const json = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const accountId = async (name: string) => String((await Account.findOne({ name }).lean<{ _id: Types.ObjectId }>())!._id);
const post = async (entity: string, body: unknown) => call(await recordsRoute.POST(json("POST", body), params({ entity })));
const patch = async (entity: string, id: string, body: unknown) => call(await recordRoute.PATCH(json("PATCH", body), params({ entity, id })));

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("comprobantes");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("plan de cuentas", () => {
  it("se carga solo con el catálogo del Anexo A y la dirección sale del código", async () => {
    const list = await call(await recordsRoute.GET(new Request("http://test/api/records/accounts?limit=300"), params({ entity: "accounts" })));
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBe(80);
    expect(list.body.items.filter((account: { code: string }) => account.code === "CI")).toHaveLength(9);
    expect(list.body.items.filter((account: { code: string }) => account.code === "GGD")).toHaveLength(37);
    expect(list.body.items.find((account: { name: string }) => account.name === "GGI - Alquileres")).toMatchObject({ code: "GGI", direction: "egreso", active: true });
    const created = await post("accounts", { code: "CI", name: "CI - ALQUILERES COBRADOS", active: "true" });
    expect(created.body).toMatchObject({ direction: "ingreso", active: true });
  });

  it("un movimiento de caja no se guarda sin cuenta, ni con una cuenta del tipo equivocado o desactivada", async () => {
    const base = { date: "2026-10-01", direction: "egreso", account: "Caja chica", description: "Peajes", amountCents: 5_000_00 };
    expect((await post("cash", base)).status).toBe(400);
    const wrong = await post("cash", { ...base, accountId: await accountId("CI - CERTIFICADOS") });
    expect(wrong).toMatchObject({ status: 400, body: { error: expect.stringContaining("ingreso") } });
    const ok = await post("cash", { ...base, accountId: await accountId("GGI - Gastos varios de movilidad -Estacionamiento, peajes, etc-") });
    expect(ok.status).toBe(201);

    // Un ingreso solo a una CI.
    expect((await post("cash", { ...base, direction: "ingreso", accountId: await accountId("GGI - Alquileres") })).status).toBe(400);

    // Una cuenta desactivada no se puede usar.
    const telefono = await accountId("GGI - Teléfono");
    await patch("accounts", telefono, { active: "false" });
    expect((await post("cash", { ...base, accountId: telefono })).body.error).toContain("desactivada");
  });

  it("cambiar la cuenta de algo ya guardado pide el motivo y deja la historia", async () => {
    const movement = await post("cash", { date: "2026-10-02", direction: "egreso", account: "Banco", description: "Alquiler galpón", amountCents: 300_000_00, accountId: await accountId("GGI - Costos administrativos") });
    const withoutReason = await patch("cash", movement.body._id, { accountId: await accountId("GGI - Alquileres") });
    expect(withoutReason).toMatchObject({ status: 400, body: { error: expect.stringContaining("por qué") } });
    const changed = await patch("cash", movement.body._id, { accountId: await accountId("GGI - Alquileres"), accountChangeReason: "Era el alquiler del galpón" });
    expect(changed.status).toBe(200);
    expect(changed.body.accountHistory).toEqual([expect.objectContaining({ fromName: "GGI - Costos administrativos", toName: "GGI - Alquileres", reason: "Era el alquiler del galpón", userName: "Administración" })]);
    expect(changed.body.accountChangeReason).toBeUndefined();
  });

  it("un pase entre cuentas deja egreso e ingreso atados y avisa si parece repetido", async () => {
    const body = { date: "2026-10-03", from: "Caja chica", to: "Banco Nación TVP", amountCents: 100_000_00 };
    const first = await call(await transferRoute.POST(json("POST", body)));
    expect(first.status).toBe(201);
    const pair = await CashMovement.find({ transferId: first.body.transferId }).sort({ direction: 1 }).lean<Array<Record<string, unknown>>>();
    expect(pair.map(row => [row.direction, row.account])).toEqual([["egreso", "Caja chica"], ["ingreso", "Banco Nación TVP"]]);
    expect(String(pair[0].accountId)).toBe(await accountId("CE - Movimiento Entre Cuentas"));
    expect(String(pair[1].accountId)).toBe(await accountId("CI - MOVIMIENTO ENTRE CUENTAS"));

    const again = await call(await transferRoute.POST(json("POST", body)));
    expect(again.status).toBe(409);
    expect((await call(await transferRoute.POST(json("POST", { ...body, confirmDuplicate: true })))).status).toBe(201);
    expect((await call(await transferRoute.POST(json("POST", { ...body, to: "Caja chica" })))).status).toBe(400);
  });

  it("los movimientos por cuenta suman por código y cuenta", async () => {
    const ledger = await call(await ledgerRoute.GET(new Request("http://test/api/accounting/ledger?from=2026-10-01&to=2026-10-31")));
    expect(ledger.status).toBe(200);
    const alquileres = ledger.body.lines.find((line: { name: string }) => line.name === "GGI - Alquileres");
    expect(alquileres).toMatchObject({ code: "GGI", outCents: 300_000_00, count: 1 });
    expect(ledger.body.lines.find((line: { name: string }) => line.name === "CI - MOVIMIENTO ENTRE CUENTAS")).toMatchObject({ inCents: 200_000_00, count: 2 });
    expect(ledger.body.byCode.find((code: { code: string }) => code.code === "GGI").outCents).toBe(305_000_00);
  });
});

describe("Factura X", () => {
  it("se numera sola desde su talonario, por empresa, y no va al libro IVA", async () => {
    const client = await Client.create({ name: "Cliente X", cuit: "20-22222222-2" });
    const draft = (await call(await draftRoute.GET(new Request("http://test/api/invoices/draft")))).body;
    expect(draft.types.tvp).toEqual(["factura_a", "factura_b", "factura_x"]);
    expect(draft.numbers.tvp.factura_x).toBe("X-0001-00000001");

    const x1 = await post("invoices", { company: "tvp", voucherType: "factura_x", number: "lo que sea", clientId: String(client._id), issueDate: "2026-10-05", netCents: 50_000_00, vatPct: 0, status: "pendiente" });
    expect(x1.status).toBe(201);
    expect(x1.body).toMatchObject({ number: "X-0001-00000001", amountCents: 50_000_00 });
    const x2 = await post("invoices", { company: "tvp", voucherType: "factura_x", clientId: String(client._id), issueDate: "2026-10-05", netCents: 10_000_00, vatPct: 0, status: "pendiente" });
    expect(x2.body.number).toBe("X-0001-00000002");
    // La otra empresa lleva su propia numeración.
    const xc = await post("invoices", { company: "constructora", voucherType: "factura_x", clientId: String(client._id), issueDate: "2026-10-05", netCents: 1_000_00, vatPct: 0, status: "pendiente" });
    expect(xc.body.number).toBe("X-0001-00000001");
    // Una fiscal sin número no entra.
    expect((await post("invoices", { company: "tvp", voucherType: "factura_a", clientId: String(client._id), issueDate: "2026-10-05", netCents: 1_00, status: "pendiente" })).status).toBe(400);
    const fiscal = await post("invoices", { company: "tvp", voucherType: "factura_a", number: "0003-00000900", clientId: String(client._id), issueDate: "2026-10-05", netCents: 100_000_00, vatPct: 21, status: "pendiente" });

    const iva = await call(await ivaRoute.GET(new Request("http://test/api/accounting/iva?from=2026-10-01&to=2026-10-31")));
    expect(iva.body.sales.map((row: { number: string }) => row.number)).toEqual(["0003-00000900"]);
    expect(iva.body.totals.sales).toEqual({ netCents: 100_000_00, vatCents: 21_000_00, totalCents: 121_000_00 });
    expect(iva.body.excludedX.sales).toBe(3);
    expect(fiscal.status).toBe(201);
  });

  it("un talonario deshabilitado no se puede usar, y la numeración de la X se puede adelantar pero no pisar", async () => {
    const client = await Client.create({ name: "Cliente talonario" });
    const books = (await call(await booksRoute.GET())).body.items as Array<{ _id: string; company: string; scope: string; voucherType: string }>;
    const constructoraB = books.find(book => book.company === "constructora" && book.scope === "venta" && book.voucherType === "factura_b")!;
    await call(await bookRoute.PATCH(json("PATCH", { active: false }), params({ id: constructoraB._id })));
    const blocked = await post("invoices", { company: "constructora", voucherType: "factura_b", number: "0002-00000001", clientId: String(client._id), issueDate: "2026-10-05", netCents: 1_00, status: "pendiente" });
    expect(blocked).toMatchObject({ status: 400, body: { error: expect.stringContaining("Factura B") } });

    const tvpX = books.find(book => book.company === "tvp" && book.scope === "venta" && book.voucherType === "factura_x")!;
    expect((await call(await bookRoute.PATCH(json("PATCH", { lastNumber: 0 }), params({ id: tvpX._id })))).status).toBe(400);
    expect((await call(await bookRoute.PATCH(json("PATCH", { lastNumber: 99 }), params({ id: tvpX._id })))).status).toBe(200);
    const next = await post("invoices", { company: "tvp", voucherType: "factura_x", clientId: String(client._id), issueDate: "2026-10-05", netCents: 1_00, status: "pendiente" });
    expect(next.body.number).toBe("X-0001-00000100");
    expect(await VoucherBook.countDocuments()).toBe(12);
  });

  it("se sustituye por una fiscal sin duplicar la venta ni el cobro", async () => {
    const client = await Client.create({ name: "Cliente sustitución" });
    const x = await post("invoices", { company: "tvp", voucherType: "factura_x", clientId: String(client._id), issueDate: "2026-10-05", netCents: 80_000_00, vatPct: 0, status: "pendiente" });
    const ci = await accountId("CI - VENTA DE MATERIALES");
    await call(await receiptsRoute.POST(json("POST", { accountId: ci, clientId: String(client._id), date: "2026-10-05", method: "efectivo", allocations: [{ invoiceId: x.body._id, amountCents: 30_000_00 }] })));
    expect(await Invoice.findById(x.body._id).lean()).toMatchObject({ collectedCents: 30_000_00, status: "parcial" });

    // Una fiscal no se pasa a X ni al revés: se sustituye.
    expect((await patch("invoices", x.body._id, { voucherType: "factura_a" })).status).toBe(400);

    const fiscal = await post("invoices", { company: "tvp", voucherType: "factura_a", number: "0003-00000950", clientId: String(client._id), issueDate: "2026-10-06", netCents: 80_000_00, vatPct: 21, status: "pendiente", replacesId: x.body._id });
    expect(fiscal.status).toBe(201);
    expect(await Invoice.findById(x.body._id).lean()).toMatchObject({ status: "sustituida", replacedById: new Types.ObjectId(fiscal.body._id as string) });
    expect(await Invoice.findById(fiscal.body._id).lean()).toMatchObject({ collectedCents: 30_000_00, status: "parcial" });
    const receipt = await Collection.findOne({ clientId: client._id }).lean<{ allocations: Array<{ invoiceId: Types.ObjectId }> }>();
    expect(String(receipt!.allocations[0].invoiceId)).toBe(fiscal.body._id);
    // La X sustituida ya no aparece para cobrar ni se vuelve a sustituir.
    const pending = await call(await receiptsRoute.GET(new Request(`http://test/api/receipts?clientId=${client._id}`)));
    expect(pending.body.items.map((row: { _id: string }) => row._id)).toEqual([fiscal.body._id]);
    expect((await post("invoices", { company: "tvp", voucherType: "factura_a", number: "0003-00000951", clientId: String(client._id), issueDate: "2026-10-06", netCents: 1_00, status: "pendiente", replacesId: x.body._id })).status).toBe(400);
  });
});

describe("compras: factura, orden de pago y pago", () => {
  it("la factura de compra hereda de la OC, la OP emitida no paga y la pagada sí", async () => {
    const supplier = await Supplier.create({ name: "Corralón Norte", cuit: "30-33333333-3" });
    const purchase = await post("purchases", { company: "constructora", supplierId: String(supplier._id), description: "Cemento", amountCents: 100_000_00, stage: "orden", status: "aprobada", requestedDate: "2026-10-01" });
    const invoice = await post("expenses", { voucherType: "factura_a", number: "0004-00001234", purchaseId: purchase.body._id, receiptRef: "R-0001-555", description: "Cemento x 100", category: "materiales", netCents: 100_000_00, amountCents: 1, issueDate: "2026-10-04", status: "pendiente", accountId: await accountId("CC - Materiales") });
    expect(invoice.status).toBe(201);
    expect(invoice.body).toMatchObject({ company: "constructora", supplierId: String(supplier._id), vatCents: 21_000_00, amountCents: 121_000_00 });
    // Una compra no se imputa a una cuenta de ingreso.
    expect((await post("expenses", { voucherType: "factura_c", number: "1", description: "x", category: "materiales", amountCents: 1_00, issueDate: "2026-10-04", status: "pendiente", accountId: await accountId("CI - CUOTA") })).status).toBe(400);

    const order = await post("payments", { company: "constructora", supplierId: String(supplier._id), expenseId: invoice.body._id, status: "emitida", date: "2026-10-05", amountCents: 121_000_00, method: "transferencia", accountId: await accountId("CC - Materiales") });
    expect(order.status).toBe(201);
    expect(order.body.number).toMatch(/^OP-\d+$/);
    expect(await Expense.findById(invoice.body._id).lean()).toMatchObject({ paidCents: 0, status: "pendiente" });
    await patch("payments", order.body._id, { status: "pagada" });
    expect(await Expense.findById(invoice.body._id).lean()).toMatchObject({ paidCents: 121_000_00, status: "pagado" });
    await patch("payments", order.body._id, { status: "anulada" });
    expect(await Expense.findById(invoice.body._id).lean()).toMatchObject({ paidCents: 0, status: "pendiente" });
    // Sin cuenta no hay pago.
    expect((await post("payments", { company: "tvp", date: "2026-10-05", amountCents: 1_00, method: "efectivo", status: "pagada" })).status).toBe(400);

    // Al libro IVA compras va la A, no un costo interno.
    await Expense.create({ description: "Material a obra", category: "materiales", amountCents: 5_000_00, issueDate: new Date("2026-10-04") });
    const iva = await call(await ivaRoute.GET(new Request("http://test/api/accounting/iva?from=2026-10-01&to=2026-10-31&company=constructora")));
    expect(iva.body.purchases).toEqual([expect.objectContaining({ number: "0004-00001234", party: "Corralón Norte", cuit: "30-33333333-3", vatCents: 21_000_00 })]);
  });
});

describe("estados de obra", () => {
  it("no se cierra con certificados sin facturar ni facturas sin cobrar", async () => {
    const client = await Client.create({ name: "Cliente obra" });
    const work = await Work.create({ code: "OB-500", name: "Obra a cerrar", clientId: client._id, status: "terminada", budgetCents: 1_000_00, certificates: [{ number: "C1", amountCents: 1_000_00, approved: true, invoiced: false }] });
    const blocked = await patch("works", String(work._id), { status: "cerrada" });
    expect(blocked).toMatchObject({ status: 400, body: { error: expect.stringContaining("C1") } });
    await Work.updateOne({ _id: work._id }, { $set: { "certificates.0.invoiced": true } });
    await Invoice.create({ number: "0003-00000999", voucherType: "factura_a", clientId: client._id, workId: work._id, issueDate: new Date(), amountCents: 1_210_00, collectedCents: 0 });
    expect((await patch("works", String(work._id), { status: "cerrada" })).body.error).toContain("sin cobrar");
    await Invoice.updateOne({ workId: work._id }, { $set: { collectedCents: 1_210_00, status: "cobrada" } });
    expect((await patch("works", String(work._id), { status: "cerrada" })).body.status).toBe("cerrada");
  });
});
