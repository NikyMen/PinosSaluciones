import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";

/*
 * El Mostrador (Ventas › Mostrador): la venta al público del Salón en un paso,
 * con remito, factura y recibo. ARCA se simula: el pedido de CAE es el real
 * (con el documento del comprador) y la respuesta, un CAE de prueba.
 */

const session = { userId: new Types.ObjectId().toHexString(), name: "Mostrador", email: "mostrador@test.local", role: "gerencia" as const, permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const sentToArca: string[] = [];
vi.mock("../src/lib/arca", async importOriginal => {
  const real = await importOriginal<typeof import("../src/lib/arca")>();
  let last = 40;
  return {
    ...real,
    arcaCredentials: (company: string) => company === "tvp" ? { cert: "tvp.crt", key: "tvp.key" } : null,
    arcaPointsOfSale: async () => [{ number: 4, blocked: false, closed: false }],
    arcaBookFor: async () => ({ pointOfSale: "0004" }),
    arcaEmitInvoice: async (_company: string, request: Parameters<typeof real.buildCaeRequest>[0]) => {
      last += 1;
      sentToArca.push(real.buildCaeRequest({ ...request, number: last }));
      return { number: last, cae: "76400000000001", caeDueDate: new Date("2026-11-29") };
    },
  };
});

const { buildCaeRequest, checkReceiver } = await import("../src/lib/arca");
const { arcaQrUrl, receiverDocument } = await import("../src/lib/fiscal");
const { CashAccount, Client, Collection, CounterSale, Invoice, SalesRemito, StockItem } = await import("../src/lib/models");
const counterRoute = await import("../src/app/api/mostrador/route");
const { xmlTag } = await import("../src/lib/arca");

let server: MongoMemoryServer;
let caja: string;
let banco: string;
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const post = (body: unknown) => counterRoute.POST(new Request("http://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("mostrador");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
  caja = String((await CashAccount.create({ company: "tvp", name: "Caja Salón", nameKey: "caja salon", type: "caja" }))._id);
  banco = String((await CashAccount.create({ company: "tvp", name: "Banco Nación TVP", nameKey: "banco nacion tvp", type: "cuenta_corriente" }))._id);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

/** Un producto en el Salón de Ventas, de TV Pino, con su precio de venta sin IVA. */
async function product(name: string, salon: number, salePriceCents: number, barcode?: string) {
  const item = await StockItem.create({ name, unit: "unidad", category: "materiales", barcode, salePriceCents, qty_salon: salon, quantity: salon, avgCostCents: 5_000, valueCents: salon * 5_000, owners: { salon: { tvp: salon } } });
  return String(item._id);
}

describe("ARCA: el documento del comprador", () => {
  const base = { voucherType: "factura_b" as const, pointOfSale: 4, number: 10, concept: 1 as const, clientCuit: "", vatCondition: "consumidor_final" as const, issueDate: new Date("2026-11-19"), netCents: 100_000, vatPct: 21, vatCents: 21_000, amountCents: 121_000 };

  it("a un consumidor final sin identificar va DocTipo 99 y número 0; con DNI, 96", () => {
    expect(receiverDocument("", "")).toMatchObject({ type: 99, number: "0" });
    expect(receiverDocument("", "30.123.456")).toMatchObject({ type: 96, number: "30123456", label: "DNI" });
    expect(receiverDocument("30-71629563-6")).toMatchObject({ type: 80, label: "CUIT" });
    let xml = buildCaeRequest(base);
    expect([xmlTag(xml, "DocTipo"), xmlTag(xml, "DocNro"), xmlTag(xml, "CondicionIVAReceptorId")]).toEqual(["99", "0", "5"]);
    xml = buildCaeRequest({ ...base, buyerDocument: "30123456" });
    expect([xmlTag(xml, "DocTipo"), xmlTag(xml, "DocNro")]).toEqual(["96", "30123456"]);
  });

  it("desde el tope hay que identificarlo; la A y el exento siguen pidiendo CUIT", () => {
    expect(() => checkReceiver({ ...base, amountCents: 10_000_000_00 })).toThrow(/identificar al consumidor final/);
    expect(() => checkReceiver({ ...base, amountCents: 10_000_000_00, buyerDocument: "30123456" })).not.toThrow();
    expect(() => checkReceiver({ ...base, voucherType: "factura_a", vatCondition: "responsable_inscripto", buyerDocument: "30123456" })).toThrow(/CUIT/);
    expect(() => checkReceiver({ ...base, vatCondition: "exento" })).toThrow(/CUIT/);
  });

  it("el QR lleva el mismo documento", () => {
    const url = arcaQrUrl({ issueDate: "2026-11-19T00:00:00.000Z", companyCuit: "30-71629563-6", pointOfSale: 4, voucherCode: 6, number: 1, amountCents: 121_000, clientCuit: "", buyerDocument: "30123456", cae: "76400000000001" });
    const payload = JSON.parse(atob(url.split("p=")[1]));
    expect(payload).toMatchObject({ tipoDocRec: 96, nroDocRec: 30123456 });
  });
});

describe("venta por mostrador", () => {
  it("con Factura X: baja el Salón, factura el remito y lo deja cobrado en un solo paso", async () => {
    // Ya había un "Consumidor Final" cargado a mano, sin condición de IVA: se usa ése.
    const existing = await Client.create({ name: "Consumidor Final" });
    const latex = await product("Látex interior 20 L", 5, 2_500_000, "7790001");
    const rodillo = await product("Rodillo 22 cm", 10, 450_000);
    const sale = await call(await post({
      company: "tvp", voucherType: "factura_x", note: "Retira en el momento",
      lines: [{ itemId: latex, quantity: 2, unitPriceCents: 2_500_000, discountCents: 100_000 }, { itemId: rodillo, quantity: 1, unitPriceCents: 450_000 }],
      payments: [{ method: "efectivo", cashAccountId: caja, amountCents: 5_350_000 }],
    }));
    expect(sale.status).toBe(201);
    expect(sale.body.warning).toBe("");
    expect(sale.body.sale).toMatchObject({ number: "VM-1", voucherType: "factura_x", status: "cobrada", netCents: 5_350_000, vatCents: 0, amountCents: 5_350_000, clientName: "Consumidor Final" });
    expect(sale.body.sale.payments).toEqual([{ method: "efectivo", account: "Caja Salón", amountCents: 5_350_000 }]);

    // El stock sale del Salón; el remito queda facturado por esa factura.
    expect(await StockItem.findById(latex).lean()).toMatchObject({ qty_salon: 3, quantity: 3 });
    expect(await StockItem.findById(rodillo).lean()).toMatchObject({ qty_salon: 9 });
    const remito = await SalesRemito.findById(sale.body.sale.remitoId).lean<Record<string, unknown>>();
    expect(remito).toMatchObject({ status: "facturado", totalCents: 5_350_000 });

    // La X sale de su talonario, del remito, cobrada por el recibo a la cuenta de venta de materiales.
    const invoice = await Invoice.findById(sale.body.sale.invoiceId).lean<Record<string, unknown>>();
    expect(invoice).toMatchObject({ voucherType: "factura_x", number: "X-0001-00000001", origin: "mostrador", status: "cobrada", collectedCents: 5_350_000, withRemito: true });
    const receipt = await Collection.findById(sale.body.sale.collectionId).lean<Record<string, unknown>>();
    expect(receipt).toMatchObject({ amountCents: 5_350_000, company: "tvp" });
    expect(String((await mongoose.model("Account").findById(receipt!.accountId).lean<{ name: string }>())?.name)).toBe("CI - VENTA DE MATERIALES");

    // El cliente genérico no se duplica.
    expect(await Client.countDocuments({ name: "Consumidor Final" })).toBe(1);
    expect(String(sale.body.sale.clientId)).toBe(String(existing._id));
  });

  it("con Factura B a consumidor final: emite en ARCA con su DNI y cobra en dos medios", async () => {
    const tornillos = await product("Caja de tornillos", 4, 1_000_000);
    const sale = await call(await post({
      company: "tvp", voucherType: "factura_b", buyerName: "Juana Pérez", buyerDocument: "30.123.456",
      lines: [{ itemId: tornillos, quantity: 1, unitPriceCents: 1_000_000 }],
      payments: [{ method: "efectivo", cashAccountId: caja, amountCents: 1_000_000 }, { method: "transferencia", cashAccountId: banco, amountCents: 210_000, reference: "Op. 123" }],
    }));
    expect(sale.status).toBe(201);
    expect(sale.body.sale).toMatchObject({ voucherType: "factura_b", buyerName: "Juana Pérez", buyerDocument: "30123456", netCents: 1_000_000, vatCents: 210_000, amountCents: 1_210_000, status: "cobrada" });
    const invoice = await Invoice.findById(sale.body.sale.invoiceId).lean<Record<string, unknown>>();
    expect(invoice).toMatchObject({ number: "0004-00000041", cae: "76400000000001", buyerDocument: "30123456", status: "cobrada" });
    const xml = sentToArca.at(-1)!;
    expect([xmlTag(xml, "DocTipo"), xmlTag(xml, "DocNro"), xmlTag(xml, "Concepto"), xmlTag(xml, "ImpTotal")]).toEqual(["96", "30123456", "1", "12100.00"]);
    expect(await Client.countDocuments({ name: "Consumidor Final" })).toBe(1);

    // El cierre del día junta los medios y los comprobantes.
    const day = await call(await counterRoute.GET(new Request(`http://test?day=${String(sale.body.sale.date).slice(0, 10)}`)));
    expect(day.body.summary).toMatchObject({ count: 2, totalCents: 6_560_000, pendingCents: 0 });
    expect(day.body.summary.byMethod).toEqual(expect.arrayContaining([{ method: "efectivo", label: "Efectivo", amountCents: 6_350_000 }, { method: "transferencia", label: "Transferencia", amountCents: 210_000 }]));
  });

  it("no mueve nada si el cobro no da el total, si falta stock o si la empresa no está en ARCA", async () => {
    const pintura = await product("Esmalte 1 L", 2, 800_000);
    const line = { itemId: pintura, quantity: 2, unitPriceCents: 800_000 };
    const before = await CounterSale.countDocuments();

    const short = await call(await post({ company: "tvp", voucherType: "factura_x", lines: [{ ...line, quantity: 3 }], payments: [{ method: "efectivo", cashAccountId: caja, amountCents: 2_400_000 }] }));
    expect(short.status).toBe(409);
    expect(short.body.error).toMatch(/No alcanza el stock del Salón/);

    const underpaid = await call(await post({ company: "tvp", voucherType: "factura_x", lines: [line], payments: [{ method: "efectivo", cashAccountId: caja, amountCents: 1_000_000 }] }));
    expect(underpaid.status).toBe(400);
    expect(underpaid.body.error).toMatch(/tiene que dar el total/);

    const noArca = await call(await post({ company: "constructora", voucherType: "factura_b", lines: [line], payments: [{ method: "efectivo", cashAccountId: caja, amountCents: 1_936_000 }] }));
    expect(noArca.status).toBe(400);
    expect(noArca.body.error).toMatch(/no está conectada con ARCA/);

    const wrongAccount = await call(await post({ company: "tvp", voucherType: "factura_x", lines: [line], payments: [{ method: "efectivo", cashAccountId: banco, amountCents: 1_600_000 }] }));
    expect(wrongAccount.status).toBe(400);
    expect(wrongAccount.body.error).toMatch(/no sirve para cobrar con efectivo/);

    expect(await StockItem.findById(pintura).lean()).toMatchObject({ qty_salon: 2 });
    expect(await CounterSale.countDocuments()).toBe(before);
  });

  it("la letra sigue al cliente y, si la factura no sale, el remito se anula y el material vuelve al Salón", async () => {
    const aRI = await Client.create({ name: "Ferretería Sur", cuit: "30-71629563-6", vatCondition: "responsable_inscripto" });
    const mecha = await product("Mecha 8 mm", 3, 300_000);
    // A un responsable inscripto no se le hace B: lo frena el chequeo previo, antes de tocar el stock.
    const wrongLetter = await call(await post({ company: "tvp", voucherType: "factura_b", clientId: String(aRI._id), lines: [{ itemId: mecha, quantity: 1, unitPriceCents: 300_000 }], payments: [{ method: "efectivo", cashAccountId: caja, amountCents: 363_000 }] }));
    expect(wrongLetter.status).toBe(400);
    expect(wrongLetter.body.error).toMatch(/corresponde la letra A/);
    expect(await StockItem.findById(mecha).lean()).toMatchObject({ qty_salon: 3 });

    // Con la A sale bien y queda a nombre del cliente.
    const ok = await call(await post({ company: "tvp", voucherType: "factura_a", clientId: String(aRI._id), lines: [{ itemId: mecha, quantity: 1, unitPriceCents: 300_000 }], payments: [{ method: "efectivo", cashAccountId: caja, amountCents: 363_000 }] }));
    expect(ok.status).toBe(201);
    expect(ok.body.sale).toMatchObject({ clientName: "Ferretería Sur", voucherType: "factura_a" });
    expect(xmlTag(sentToArca.at(-1)!, "DocTipo")).toBe("80");

    // Si la factura falla después del remito (acá, el número de la X choca con una que ya tiene el cliente), el stock vuelve.
    const { VoucherBook } = await import("../src/lib/models");
    await VoucherBook.updateMany({ company: "tvp", voucherType: "factura_x" }, { $set: { lastNumber: 0 } });
    await Invoice.updateOne({ number: "X-0001-00000001" }, { $set: { clientId: aRI._id } });
    const clash = await call(await post({ company: "tvp", voucherType: "factura_x", clientId: String(aRI._id), lines: [{ itemId: mecha, quantity: 2, unitPriceCents: 300_000 }], payments: [{ method: "efectivo", cashAccountId: caja, amountCents: 600_000 }] }));
    expect(clash.status).toBeGreaterThanOrEqual(400);
    expect(await StockItem.findById(mecha).lean()).toMatchObject({ qty_salon: 2 });
    expect(await SalesRemito.findOne({ clientId: aRI._id, status: "anulado" }).lean()).toBeTruthy();
  });
});
