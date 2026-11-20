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
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const post = (body: unknown) => counterRoute.POST(new Request("http://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("mostrador");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
  // Sólo se elige el medio: el efectivo va a la caja y la transferencia al banco, solos.
  await CashAccount.create({ company: "tvp", name: "Caja Salón", nameKey: "caja salon", type: "caja" });
  await CashAccount.create({ company: "tvp", name: "Banco Nación TVP", nameKey: "banco nacion tvp", type: "cuenta_corriente" });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

/** Un producto de TV Pino en el Salón (y, si se dice, en el Galpón), con su precio de venta sin IVA. */
async function product(name: string, salon: number, salePriceCents: number, barcode?: string, central = 0) {
  const item = await StockItem.create({ name, unit: "unidad", category: "materiales", barcode, salePriceCents, qty_salon: salon, qty_central: central, quantity: salon + central, avgCostCents: 5_000, valueCents: (salon + central) * 5_000, owners: { salon: { tvp: salon }, ...(central && { central: { tvp: central } }) } });
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
  it("con Factura X: baja el Salón, factura el remito y lo deja cobrado en la caja, en un solo paso", async () => {
    // Ya había un "Consumidor Final" cargado a mano, sin condición de IVA: se usa ése.
    const existing = await Client.create({ name: "Consumidor Final" });
    const latex = await product("Látex interior 20 L", 5, 2_500_000, "7790001");
    const rodillo = await product("Rodillo 22 cm", 10, 450_000);
    const sale = await call(await post({
      company: "tvp", voucherType: "factura_x", note: "Retira en el momento", method: "efectivo",
      lines: [{ itemId: latex, quantity: 2, unitPriceCents: 2_500_000, discountCents: 100_000 }, { itemId: rodillo, quantity: 1, unitPriceCents: 450_000 }],
    }));
    expect(sale.status).toBe(201);
    expect(sale.body.warning).toBe("");
    expect(sale.body.sale).toMatchObject({ number: "VM-1", voucherType: "factura_x", status: "cobrada", netCents: 5_350_000, vatCents: 0, amountCents: 5_350_000, clientName: "Consumidor Final" });
    // Sólo se dijo el medio: el efectivo entra a la caja, no al banco.
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

  it("con Factura B a consumidor final: emite en ARCA sin identificarlo y la transferencia entra al banco", async () => {
    const tornillos = await product("Caja de tornillos", 4, 1_000_000);
    const sale = await call(await post({ company: "tvp", voucherType: "factura_b", method: "transferencia", lines: [{ itemId: tornillos, quantity: 1, unitPriceCents: 1_000_000 }] }));
    expect(sale.status).toBe(201);
    expect(sale.body.sale).toMatchObject({ voucherType: "factura_b", netCents: 1_000_000, vatCents: 210_000, amountCents: 1_210_000, status: "cobrada" });
    expect(sale.body.sale.payments).toEqual([{ method: "transferencia", account: "Banco Nación TVP", amountCents: 1_210_000 }]);
    const invoice = await Invoice.findById(sale.body.sale.invoiceId).lean<Record<string, unknown>>();
    expect(invoice).toMatchObject({ number: "0004-00000041", cae: "76400000000001", status: "cobrada" });
    const xml = sentToArca.at(-1)!;
    expect([xmlTag(xml, "DocTipo"), xmlTag(xml, "DocNro"), xmlTag(xml, "Concepto"), xmlTag(xml, "ImpTotal")]).toEqual(["99", "0", "1", "12100.00"]);

    // El cierre del día junta los medios y los comprobantes.
    const day = await call(await counterRoute.GET(new Request(`http://test?day=${String(sale.body.sale.date).slice(0, 10)}`)));
    expect(day.body.summary).toMatchObject({ count: 2, totalCents: 6_560_000, pendingCents: 0 });
    expect(day.body.summary.byMethod).toEqual(expect.arrayContaining([{ method: "efectivo", label: "Efectivo", amountCents: 5_350_000 }, { method: "transferencia", label: "Transferencia", amountCents: 1_210_000 }]));
  });

  it("vende lo del Galpón: primero sale del Salón y lo que falta del Galpón; al anular, cada parte vuelve a su depósito", async () => {
    const cemento = await product("Cemento 50 kg", 1, 1_500_000, undefined, 5);
    // Sólo del Salón no alcanza.
    const onlySalon = await call(await post({ company: "tvp", voucherType: "factura_x", method: "efectivo", from: "salon", lines: [{ itemId: cemento, quantity: 3, unitPriceCents: 1_500_000 }] }));
    expect(onlySalon.status).toBe(409);
    expect(onlySalon.body.error).toMatch(/No alcanza el stock del Salón/);

    // Salón y Galpón (lo que hace el Mostrador por defecto): 1 del Salón y 2 del Galpón, con el descuento repartido.
    const sale = await call(await post({ company: "tvp", voucherType: "factura_x", method: "efectivo", lines: [{ itemId: cemento, quantity: 3, unitPriceCents: 1_500_000, discountCents: 300_000 }] }));
    expect(sale.status).toBe(201);
    expect(sale.body.sale.amountCents).toBe(4_200_000);
    expect(sale.body.sale.lines.map((line: { warehouse: string; quantity: number; discountCents?: number }) => [line.warehouse, line.quantity, line.discountCents])).toEqual([["salon", 1, 100_000], ["central", 2, 200_000]]);
    expect(await StockItem.findById(cemento).lean()).toMatchObject({ qty_salon: 0, qty_central: 3, quantity: 3 });

    // El catálogo del Mostrador muestra lo que tiene stock en cualquiera de los dos depósitos, y filtra por cada palabra.
    const { counterCatalog } = await import("../src/lib/counter-sales");
    expect((await counterCatalog("cem 50")).items.map(item => item.name)).toEqual(["Cemento 50 kg"]);
    expect((await counterCatalog("cemento", "salon")).items).toEqual([]);

    // Un remito anulado (sin la factura) devuelve cada parte a su depósito.
    const other = await call(await post({ company: "tvp", voucherType: "factura_x", method: "efectivo", lines: [{ itemId: cemento, quantity: 1, unitPriceCents: 1_500_000 }] }));
    expect(other.status).toBe(201);
    const { cancelSalesRemito } = await import("../src/lib/sales-remitos");
    await Invoice.updateOne({ _id: other.body.sale.invoiceId }, { $set: { status: "anulada" } });
    await SalesRemito.updateOne({ _id: other.body.sale.remitoId }, { $set: { status: "pendiente" } });
    await cancelSalesRemito(String(other.body.sale.remitoId), "prueba", session);
    expect(await StockItem.findById(cemento).lean()).toMatchObject({ qty_salon: 0, qty_central: 3 });
  });

  it("no mueve nada si falta stock, si la empresa no está en ARCA o no tiene dónde cobrar", async () => {
    const pintura = await product("Esmalte 1 L", 2, 800_000);
    const line = { itemId: pintura, quantity: 2, unitPriceCents: 800_000 };
    const before = await CounterSale.countDocuments();

    const short = await call(await post({ company: "tvp", voucherType: "factura_x", method: "efectivo", lines: [{ ...line, quantity: 3 }] }));
    expect(short.status).toBe(409);
    expect(short.body.error).toMatch(/No alcanza el stock/);

    const noArca = await call(await post({ company: "constructora", voucherType: "factura_b", method: "efectivo", lines: [line] }));
    expect(noArca.status).toBe(400);
    expect(noArca.body.error).toMatch(/no está conectada con ARCA/);

    const noAccount = await call(await post({ company: "constructora", voucherType: "factura_x", method: "efectivo", lines: [line] }));
    expect(noAccount.status).toBe(400);
    expect(noAccount.body.error).toMatch(/Falta una cuenta para cobrar con efectivo de Constructora/);

    const noCard = await call(await post({ company: "tvp", voucherType: "factura_x", method: "tarjeta", lines: [line] }));
    expect(noCard.status).toBe(400);
    expect(noCard.body.error).toMatch(/Falta una cuenta para cobrar con tarjeta/);

    expect(await StockItem.findById(pintura).lean()).toMatchObject({ qty_salon: 2 });
    expect(await CounterSale.countDocuments()).toBe(before);
  });

  it("la letra sigue al cliente y, si la factura no sale, el remito se anula y el material vuelve al Salón", async () => {
    const aRI = await Client.create({ name: "Ferretería Sur", cuit: "30-71629563-6", vatCondition: "responsable_inscripto" });
    const mecha = await product("Mecha 8 mm", 3, 300_000);
    // A un responsable inscripto no se le hace B: lo frena el chequeo previo, antes de tocar el stock.
    const wrongLetter = await call(await post({ company: "tvp", voucherType: "factura_b", method: "efectivo", clientId: String(aRI._id), lines: [{ itemId: mecha, quantity: 1, unitPriceCents: 300_000 }] }));
    expect(wrongLetter.status).toBe(400);
    expect(wrongLetter.body.error).toMatch(/corresponde la letra A/);
    expect(await StockItem.findById(mecha).lean()).toMatchObject({ qty_salon: 3 });

    // Con la A sale bien y queda a nombre del cliente.
    const ok = await call(await post({ company: "tvp", voucherType: "factura_a", method: "efectivo", clientId: String(aRI._id), lines: [{ itemId: mecha, quantity: 1, unitPriceCents: 300_000 }] }));
    expect(ok.status).toBe(201);
    expect(ok.body.sale).toMatchObject({ clientName: "Ferretería Sur", voucherType: "factura_a" });
    expect(xmlTag(sentToArca.at(-1)!, "DocTipo")).toBe("80");

    // Si la factura falla después del remito (acá, el número de la X choca con una que ya tiene el cliente), el stock vuelve.
    const { VoucherBook } = await import("../src/lib/models");
    await VoucherBook.updateMany({ company: "tvp", voucherType: "factura_x" }, { $set: { lastNumber: 0 } });
    await Invoice.updateOne({ number: "X-0001-00000001" }, { $set: { clientId: aRI._id } });
    const clash = await call(await post({ company: "tvp", voucherType: "factura_x", method: "efectivo", clientId: String(aRI._id), lines: [{ itemId: mecha, quantity: 2, unitPriceCents: 300_000 }] }));
    expect(clash.status).toBeGreaterThanOrEqual(400);
    expect(await StockItem.findById(mecha).lean()).toMatchObject({ qty_salon: 2 });
    expect(await SalesRemito.findOne({ clientId: aRI._id, status: "anulado" }).lean()).toBeTruthy();
  });
});

describe("precio de venta e historial", () => {
  it("Guardar desde el Mostrador y editar en la ficha de Stock dejan quién, cuándo y de cuánto a cuánto", async () => {
    const priceRoute = await import("../src/app/api/stock/[id]/precio/route");
    const recordRoute = await import("../src/app/api/records/[entity]/[id]/route");
    const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
    const json = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const disco = await product("Disco sierra widia", 0, 0, undefined, 1);

    // Sin precio: se guarda desde el Mostrador.
    const saved = await call(await priceRoute.PUT(json("PUT", { salePriceCents: 1_000_000, source: "mostrador" }), params({ id: disco })));
    expect(saved.status).toBe(200);
    expect(await StockItem.findById(disco).lean()).toMatchObject({ salePriceCents: 1_000_000 });
    expect((await call(await priceRoute.PUT(json("PUT", { salePriceCents: 0 }), params({ id: disco })))).status).toBe(400);

    // Después se cambia en la ficha de Stock; un cambio de otra cosa no anota precio.
    expect((await call(await recordRoute.PATCH(json("PATCH", { salePriceCents: 1_250_000 }), params({ entity: "stock", id: disco })))).status).toBe(200);
    expect((await call(await recordRoute.PATCH(json("PATCH", { notes: "Estante 3" }), params({ entity: "stock", id: disco })))).status).toBe(200);

    const history = await call(await priceRoute.GET(new Request("http://test"), params({ id: disco })));
    expect(history.body.items.map((change: Record<string, unknown>) => [change.previousCents ?? null, change.salePriceCents, change.source, change.userName])).toEqual([
      [1_000_000, 1_250_000, "stock", "Mostrador"],
      [null, 1_000_000, "mostrador", "Mostrador"],
    ]);
    expect(history.body.items[0].createdAt).toBeTruthy();
  });

  it("el precio con IVA y sin IVA se calculan uno del otro", async () => {
    const { withVatCents, withoutVatCents } = await import("../src/lib/counter-totals");
    expect(withVatCents(1_000_000)).toBe(1_210_000);
    expect(withoutVatCents(1_210_000)).toBe(1_000_000);
    // El precio se guarda sin IVA en centavos: al volver a sumarle el IVA puede haber un centavo de diferencia.
    expect(Math.abs(withVatCents(withoutVatCents(999_999)) - 999_999)).toBeLessThanOrEqual(1);
  });
});

describe("servicios en el mostrador", () => {
  it("una venta de sólo servicios factura el concepto, sin remito ni stock", async () => {
    // Otro test reinicia a propósito la numeración de la X: acá sigue de más adelante.
    const { VoucherBook } = await import("../src/lib/models");
    await VoucherBook.updateMany({ company: "tvp", voucherType: "factura_x" }, { $set: { lastNumber: 100 } });
    const sale = await call(await post({ company: "tvp", voucherType: "factura_x", method: "efectivo", services: [{ description: "Corte a medida", quantity: 2, unit: "unidad", unitPriceCents: 150_000 }] }));
    expect(sale.status).toBe(201);
    expect(sale.body.sale).toMatchObject({ amountCents: 300_000, status: "cobrada" });
    expect(sale.body.sale.remitoId).toBeUndefined();
    expect(sale.body.sale.lines).toEqual([expect.objectContaining({ service: true, name: "Corte a medida", quantity: 2, unitPriceCents: 150_000, totalCents: 300_000 })]);
    const invoice = await Invoice.findById(sale.body.sale.invoiceId).lean<Record<string, unknown>>();
    expect(invoice).toMatchObject({ netCents: 300_000, withRemito: false, status: "cobrada", lines: [{ description: "Corte a medida", quantity: 2, unit: "unidad", unitCents: 150_000 }] });
  });

  it("productos y servicios juntos: el remito lleva los productos y la factura suma los dos (concepto mixto en ARCA)", async () => {
    const membrana = await product("Membrana 4 mm", 3, 2_000_000);
    const sale = await call(await post({
      company: "tvp", voucherType: "factura_b", method: "transferencia",
      lines: [{ itemId: membrana, quantity: 1, unitPriceCents: 2_000_000 }],
      services: [{ description: "Colocación de membrana", quantity: 10, unit: "m2", unitPriceCents: 300_000 }],
    }));
    expect(sale.status).toBe(201);
    expect(sale.body.sale).toMatchObject({ netCents: 5_000_000, vatCents: 1_050_000, amountCents: 6_050_000, status: "cobrada" });
    expect(await StockItem.findById(membrana).lean()).toMatchObject({ qty_salon: 2 });
    const invoice = await Invoice.findById(sale.body.sale.invoiceId).lean<Record<string, unknown>>();
    expect(invoice).toMatchObject({ netCents: 5_000_000, withRemito: true, status: "cobrada" });
    expect((invoice!.lines as unknown[]).length).toBe(1);
    expect(await SalesRemito.findById(sale.body.sale.remitoId).lean()).toMatchObject({ status: "facturado", totalCents: 2_000_000 });
    expect([xmlTag(sentToArca.at(-1)!, "Concepto"), xmlTag(sentToArca.at(-1)!, "ImpNeto")]).toEqual(["3", "50000.00"]);

    // Sin nada no se vende; un servicio sin precio tampoco.
    expect((await call(await post({ company: "tvp", voucherType: "factura_x", method: "efectivo" }))).body.error).toMatch(/al menos un producto o un servicio/);
    expect((await call(await post({ company: "tvp", voucherType: "factura_x", method: "efectivo", services: [{ description: "Flete", quantity: 1, unitPriceCents: 0 }] }))).status).toBe(400);
  });
});

describe("precio final de la lista del proveedor (Protex)", () => {
  it("lo pasa a Stock, lo toma un material nuevo, y lo que no está en Stock se ve sin stock en el Mostrador", async () => {
    const { PriceList, PriceListItem, Supplier, StockPriceChange } = await import("../src/lib/models");
    const { applyListSalePrices } = await import("../src/lib/sale-prices");
    const { counterCatalog } = await import("../src/lib/counter-sales");
    const supplier = await Supplier.create({ name: "PROKRETE ARGENTINA SA" });
    const list = await PriceList.create({ supplierId: supplier._id, validFrom: new Date("2026-09-01"), fileName: "protex.xlsx", current: true, itemCount: 4 });
    const listItem = (code: string, name: string, gross: number, presentation = "Balde 20 KG") => ({ supplierId: supplier._id, priceListId: list._id, current: true, code, name, presentation, listPriceCents: gross, consumerGrossCents: gross });
    await PriceListItem.insertMany([
      listItem("JUE905", "PROTEX SEAL 77", 5_735_520, "Kit 33 KG"),
      listItem("10032/25", "PROTEX TAP", 1_210_000, "Balde 25 KG"),
      listItem("10030/20", "PROTEX LATEX", 2_420_000),
      listItem("", "ECOFIX HD", 999_999),
    ]);
    // En Stock: una variante (JUE905-BIDON), uno exacto, y uno de otra marca sin código.
    const bidon = await StockItem.create({ name: "PROTEX SEAL 77 BIDÓN", sku: "JUE905-BIDON", unit: "unidad", category: "materiales", qty_salon: 4, quantity: 4 });
    expect(bidon.salePriceCents).toBe(4_740_099); // Un material nuevo toma el precio de la lista solo.
    const tap = await StockItem.collection.insertOne({ name: "PROTEX TAP · Balde 25 KG", sku: "10032/25", unit: "unidad", category: "materiales", qty_salon: 6, quantity: 6, movements: [] });
    const alba = await StockItem.create({ name: "ALBALATEX X20LTS", unit: "unidad", category: "materiales", qty_salon: 3, quantity: 3 });

    // La carga inicial: sólo el que todavía no tenía precio; el de otra marca no se toca.
    const preview = await applyListSalePrices({ apply: false, actor: { name: "Lista de precios" } });
    expect(preview.map(change => [change.sku, change.salePriceCents])).toEqual([["10032/25", 1_000_000]]);
    await applyListSalePrices({ apply: true, actor: { name: "Lista de precios" } });
    expect(await StockItem.findById(tap.insertedId).lean()).toMatchObject({ salePriceCents: 1_000_000 });
    expect((await StockItem.findById(alba._id).lean() as { salePriceCents?: number }).salePriceCents).toBeUndefined();
    expect(await StockPriceChange.find({ stockItemId: { $in: [bidon._id, tap.insertedId] } }).lean()).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "lista", userName: "Lista de precios", salePriceCents: 4_740_099 }),
      expect.objectContaining({ source: "lista", userName: "Lista de precios", salePriceCents: 1_000_000 }),
    ]));

    // En el Mostrador: el Látex de la lista no está en Stock y se ve "sin stock" con su precio; el Seal 77 y el Tap ya están.
    const catalog = await counterCatalog("protex");
    const listOnly = catalog.items.filter(item => (item as { listOnly?: boolean }).listOnly);
    expect(listOnly.map(item => [item.name, item.salePriceCents])).toEqual([["PROTEX LATEX · Balde 20 KG", 2_000_000]]);
    expect(catalog.items.filter(item => !(item as { listOnly?: boolean }).listOnly).map(item => item.name)).toEqual(expect.arrayContaining(["PROTEX SEAL 77 BIDÓN", "PROTEX TAP · Balde 25 KG"]));
  });
});
