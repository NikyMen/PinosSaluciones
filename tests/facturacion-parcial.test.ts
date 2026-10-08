import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";
import { quoteBilling, invoiceNetCents } from "../src/lib/quote-billing";
import { remitoPendingCents, invoiceLinesNetCents } from "../src/lib/remito-billing";

// La sesión se puede cambiar de rol en cada prueba.
const session = { userId: new Types.ObjectId().toHexString(), name: "Gerencia de prueba", email: "gerencia@test.local", role: "gerencia" as "gerencia" | "administracion", permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { Client, Quote, Work, Invoice, SalesRemito, StockItem } = await import("../src/lib/models");
const recordsRoute = await import("../src/app/api/records/[entity]/route");
const recordRoute = await import("../src/app/api/records/[entity]/[id]/route");
const billingRoute = await import("../src/app/api/quotes/[id]/billing/route");
const adjustmentsRoute = await import("../src/app/api/quotes/[id]/adjustments/route");
const draftRoute = await import("../src/app/api/invoices/draft/route");
const trackingRoute = await import("../src/app/api/tracking/route");

let server: MongoMemoryServer;
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const json = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
let invoiceNumber = 700;
const nextNumber = () => `0003-${String(++invoiceNumber).padStart(8, "0")}`;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("facturacion-parcial");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

function asRole(role: "gerencia" | "administracion") {
  session.role = role;
  session.permissions = defaultPermissionsForRole(role);
}

describe("cuánto se facturó de una cotización (cálculo)", () => {
  it("vigente con adicionales y reducciones, notas de crédito y débito, y las anuladas no cuentan", () => {
    const billing = quoteBilling({
      netCents: 1_000_000_00,
      adjustments: [{ kind: "adicional", netCents: 200_000_00 }, { kind: "reduccion", netCents: 50_000_00 }],
      invoices: [
        { voucherType: "factura_a", netCents: 400_000_00, amountCents: 484_000_00, status: "pendiente" },
        { voucherType: "factura_x", amountCents: 100_000_00, status: "cobrada" },
        { voucherType: "nota_credito_a", netCents: 50_000_00, amountCents: 60_500_00, status: "aplicada" },
        { voucherType: "nota_debito_a", netCents: 10_000_00, amountCents: 12_100_00, status: "pendiente" },
        { voucherType: "factura_a", netCents: 999_000_00, status: "anulada" },
        { voucherType: "factura_x", amountCents: 999_000_00, status: "sustituida" },
      ],
      enabledSourcesCents: 900_000_00,
    });
    expect(billing).toMatchObject({ originalCents: 1_000_000_00, additionsCents: 200_000_00, reductionsCents: 50_000_00, currentCents: 1_150_000_00, invoicedCents: 460_000_00, pendingCents: 690_000_00, state: "parcial", invoicedPct: 40 });
    // Lo habilitado no pasa del pendiente.
    expect(billing.enabledCents).toBe(690_000_00);
  });

  it("estados: sin facturar, total (con la diferencia de redondeo del IVA) y en exceso", () => {
    expect(quoteBilling({ netCents: 100_00, invoices: [] }).state).toBe("sin_facturar");
    expect(quoteBilling({ netCents: 1_000_000_00, invoices: [{ voucherType: "factura_a", netCents: 999_999_50 }] })).toMatchObject({ state: "total", pendingCents: 0 });
    expect(quoteBilling({ netCents: 1_000_000_00, invoices: [{ voucherType: "factura_a", netCents: 1_100_000_00 }] })).toMatchObject({ state: "exceso", excessCents: 100_000_00, pendingCents: 0 });
    // Una A vieja cargada sólo con el total cuenta por su neto.
    expect(invoiceNetCents({ voucherType: "factura_a", amountCents: 121_00 })).toBe(100_00);
  });

  it("remitos facturados en parte: lo pendiente y lo que vale cada parte suman el total exacto", () => {
    const remito = { _id: "r1", status: "parcial", lines: [{ quantity: 3, unitPriceCents: 333_33, totalCents: 1000_00, invoicedQty: 1 }, { quantity: 2, unitPriceCents: 50_00, totalCents: 100_00 }] };
    expect(remitoPendingCents(remito)).toBe(1000_00 - 333_33 + 100_00);
    // Facturar los 2 que quedan del primer renglón completa el total, sin perder el centavo.
    expect(invoiceLinesNetCents([remito], [{ remitoId: "r1", line: 0, quantity: 2 }])).toBe(1000_00 - 333_33);
    // Un remito viejo facturado entero no tiene nada pendiente.
    expect(remitoPendingCents({ status: "facturado", lines: [{ quantity: 4, totalCents: 400_00 }] })).toBe(0);
  });
});

describe("control al facturar", () => {
  it("bloquea la factura que pasa de lo pendiente; Gerencia la autoriza con motivo y queda en el historial", async () => {
    asRole("gerencia");
    const client = await Client.create({ name: "Cliente exceso" });
    const quote = await Quote.create({ number: "COT-E1", clientId: client._id, title: "Impermeabilización", amountCents: 1_210_000_00, netCents: 1_000_000_00, status: "aprobada" });
    const base = { voucherType: "factura_a", clientId: String(client._id), quoteId: String(quote._id), issueDate: "2026-10-08", vatPct: 21, status: "pendiente" };

    const first = await call(await recordsRoute.POST(json("POST", { ...base, number: nextNumber(), netCents: 600_000_00 }), params({ entity: "invoices" })));
    expect(first.status).toBe(201);

    // Quedan 400.000 netos: una de 500.000 no entra.
    const blocked = await call(await recordsRoute.POST(json("POST", { ...base, number: nextNumber(), netCents: 500_000_00 }), params({ entity: "invoices" })));
    expect(blocked.status).toBe(409);
    expect(blocked.body.excess).toBe(true);
    expect(blocked.body.error).toContain("COT-E1");

    // Administración no la puede forzar, ni con motivo.
    asRole("administracion");
    const notAllowed = await call(await recordsRoute.POST(json("POST", { ...base, number: nextNumber(), netCents: 500_000_00, excessReason: "Lo pidió el cliente" }), params({ entity: "invoices" })));
    expect(notAllowed.status).toBe(409);

    // Un adicional acordado agranda lo vigente: ahora sí entra.
    asRole("gerencia");
    const added = await call(await adjustmentsRoute.POST(json("POST", { kind: "adicional", netCents: 100_000_00, reason: "Paño extra en el contrafrente" }), params({ id: String(quote._id) })));
    expect(added.status).toBe(201);
    const fits = await call(await recordsRoute.POST(json("POST", { ...base, number: nextNumber(), netCents: 500_000_00 }), params({ entity: "invoices" })));
    expect(fits.status).toBe(201);

    // Ya está toda facturada: una más sólo con el motivo de Gerencia.
    const forced = await call(await recordsRoute.POST(json("POST", { ...base, number: nextNumber(), netCents: 50_000_00, excessReason: "Ajuste por mayores costos acordado" }), params({ entity: "invoices" })));
    expect(forced.status).toBe(201);
    expect(forced.body.excessApproval).toMatchObject({ reason: "Ajuste por mayores costos acordado", userName: "Gerencia de prueba" });
    const history = (await Quote.findById(quote._id).lean<{ history: Array<{ action: string; note?: string }> }>())!.history;
    expect(history.some(entry => entry.action === "Factura en exceso autorizada" && entry.note?.includes("Ajuste por mayores costos"))).toBe(true);

    const billing = await call(await billingRoute.GET(new Request("http://test"), params({ id: String(quote._id) })));
    expect(billing.body.billing).toMatchObject({ originalCents: 1_000_000_00, additionsCents: 100_000_00, currentCents: 1_100_000_00, invoicedCents: 1_150_000_00, state: "exceso", excessCents: 50_000_00 });
    expect(billing.body.invoices).toHaveLength(3);
    expect(billing.body.adjustments).toHaveLength(1);

    // Una nota de crédito nunca se frena: resta.
    const credit = await call(await recordsRoute.POST(json("POST", { ...base, voucherType: "nota_credito_a", associatedInvoiceId: forced.body._id, number: nextNumber(), netCents: 50_000_00 }), params({ entity: "invoices" })));
    expect(credit.status).toBe(201);
    const after = await call(await billingRoute.GET(new Request("http://test"), params({ id: String(quote._id) })));
    expect(after.body.billing).toMatchObject({ invoicedCents: 1_100_000_00, state: "total" });

    // Seguimiento muestra lo mismo.
    const tracking = await call(await trackingRoute.GET());
    const row = tracking.body.items.find((item: { quote: { number: string } | null }) => item.quote?.number === "COT-E1");
    expect(row.billing).toMatchObject({ currentCents: 1_100_000_00, invoicedCents: 1_100_000_00, state: "total" });
  });

  it("la factura de un certificado no pasa del certificado", async () => {
    asRole("gerencia");
    const client = await Client.create({ name: "Cliente certificado" });
    const quote = await Quote.create({ number: "COT-E2", clientId: client._id, title: "Fachada", amountCents: 12_100_000_00, netCents: 10_000_000_00, status: "convertida" });
    const work = await Work.create({ code: "OB-E2", name: "Fachada", clientId: client._id, quoteId: quote._id, status: "en_curso", budgetCents: 12_100_000_00, budgetNetCents: 10_000_000_00,
      certificates: [{ number: "C1", period: "Octubre", percentage: 10, amountCents: 1_000_000_00, approved: true, invoiced: false }] });
    const certificateId = String((await Work.findById(work._id).lean<{ certificates: Array<{ _id: unknown }> }>())!.certificates[0]._id);

    // El certificado aprobado sin facturar es lo habilitado.
    const billing = await call(await billingRoute.GET(new Request("http://test"), params({ id: String(quote._id) })));
    expect(billing.body.billing.enabledCents).toBe(1_000_000_00);

    const tooMuch = await call(await recordsRoute.POST(json("POST", { voucherType: "factura_a", number: nextNumber(), clientId: String(client._id), workId: String(work._id), certificateId, certificateNumber: "C1", issueDate: "2026-10-08", netCents: 1_200_000_00, vatPct: 21, status: "pendiente" }), params({ entity: "invoices" })));
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error).toContain("certificado C1");
  });
});

describe("remitos facturados en parte", () => {
  it("factura una parte, después el resto, y al anular devuelve lo que facturaba", async () => {
    asRole("gerencia");
    const client = await Client.create({ name: "Corralón del cliente" });
    const quote = await Quote.create({ number: "COT-R1", clientId: client._id, title: "Venta de materiales", amountCents: 121_000_00, netCents: 100_000_00, status: "aprobada" });
    const item = await StockItem.create({ name: "Pegatex porcelanato", unit: "bolsa", category: "materiales" });
    const other = await StockItem.create({ name: "Pastina", unit: "kg", category: "materiales" });
    const remito = await SalesRemito.create({
      number: "R-500", clientId: client._id, quoteId: quote._id, date: new Date(), totalCents: 50_000_00,
      lines: [{ stockItemId: item._id, name: "Pegatex porcelanato", unit: "bolsa", quantity: 4, unitPriceCents: 10_000_00, totalCents: 40_000_00 }, { stockItemId: other._id, name: "Pastina", unit: "kg", quantity: 2, unitPriceCents: 5_000_00, totalCents: 10_000_00 }],
    });

    // El remito pendiente habilita la cotización a facturar.
    expect((await call(await billingRoute.GET(new Request("http://test"), params({ id: String(quote._id) })))).body.billing.enabledCents).toBe(50_000_00);

    // El borrador trae cada renglón con lo pendiente.
    const draft = (await call(await draftRoute.GET(new Request(`http://test/api/invoices/draft?remitos=${remito._id}`)))).body;
    expect(draft.netCents).toBe(50_000_00);
    expect(draft.remitoDetail[0].lines.map((line: { pendingQty: number }) => line.pendingQty)).toEqual([4, 2]);

    // Primero 3 bolsas de Pegatex.
    const base = { voucherType: "factura_x", clientId: String(client._id), quoteId: String(quote._id), issueDate: "2026-10-08", vatPct: 0, status: "pendiente", remitoIds: [String(remito._id)] };
    const first = await call(await recordsRoute.POST(json("POST", { ...base, netCents: 30_000_00, remitoLines: JSON.stringify([{ remitoId: String(remito._id), line: 0, quantity: 3 }]) }), params({ entity: "invoices" })));
    expect(first.status).toBe(201);
    let saved = await SalesRemito.findById(remito._id).lean<{ status: string; lines: Array<{ invoicedQty?: number }> }>();
    expect(saved).toMatchObject({ status: "parcial" });
    expect(saved!.lines.map(line => line.invoicedQty)).toEqual([3, 0]);

    // No se puede facturar más de lo que queda del renglón.
    const over = await call(await recordsRoute.POST(json("POST", { ...base, netCents: 20_000_00, remitoLines: [{ remitoId: String(remito._id), line: 0, quantity: 2 }] }), params({ entity: "invoices" })));
    expect(over.status).toBe(400);

    // El resto, sin decir cantidades: todo lo pendiente.
    const rest = await call(await recordsRoute.POST(json("POST", { ...base, netCents: 20_000_00 }), params({ entity: "invoices" })));
    expect(rest.status).toBe(201);
    saved = await SalesRemito.findById(remito._id).lean();
    expect(saved).toMatchObject({ status: "facturado" });
    expect(saved!.lines.map(line => line.invoicedQty)).toEqual([4, 2]);

    // Anulada la primera, vuelven a quedar 3 bolsas por facturar.
    await recordRoute.PATCH(json("PATCH", { status: "anulada" }), params({ entity: "invoices", id: first.body._id }));
    saved = await SalesRemito.findById(remito._id).lean();
    expect(saved).toMatchObject({ status: "parcial" });
    expect(saved!.lines.map(line => line.invoicedQty)).toEqual([1, 2]);
    expect(remitoPendingCents(saved as never)).toBe(30_000_00);

    // Borrada la segunda, el remito queda pendiente entero.
    await recordRoute.DELETE(new Request("http://test", { method: "DELETE" }), params({ entity: "invoices", id: rest.body._id }));
    saved = await SalesRemito.findById(remito._id).lean();
    expect(saved).toMatchObject({ status: "pendiente" });
    expect(await Invoice.countDocuments({ remitoIds: remito._id, status: { $ne: "anulada" } })).toBe(0);
  });
});
