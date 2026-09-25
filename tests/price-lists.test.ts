import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";
import { analyzeWorkbook, compareLists, discounted, markBest, measureOf, parsePrice, withVat, type ParsedPriceItem } from "../src/lib/price-lists";

/*
 * Listas de precios: la lectura del Excel con una planilla armada igual que la
 * de Protex (membrete, rubros numerados, subrubros, títulos repetidos, filas
 * que heredan el nombre, leyenda al pie) y el circuito contra una base real en
 * memoria: importar, reemplazar, buscar y descontar.
 */

const protexLike: unknown[][] = [
  [null, null, null, null, null, null, null, null, null],
  [null, null, null, "PROKRETE ARGENTINA S.A.", null, null, null, null, null],
  [null, null, null, "LISTA DE PRECIOS SIN IVA", null, null, null, null, null],
  [null, null, null, "VIGENTE A PARTIR DEL 02-09-2026", null, null, null, null, null],
  [null, "01. IMPERMEABILIZANTES", null, null, null, null, null, null, null],
  [null, "CÓDIGO", "PRODUCTO", "DESCRIPCIÓN", "PRESENTACIÓN", null, "MIN. VENTA", "PRECIO", "TIPO"],
  [null, "IMPERMEABILIZANTES PARA CUBIERTAS", null, null, null, null, null, null, null],
  [null, "5000PU20", "TECHOS 5000 PU", "Membrana líquida \r\npoliuretánica.", "Balde", "20 KG", "1 Unidad", 234556, "A"],
  [null, "5000PU5", null, null, null, "5 KG", "1 Unidad", 62837, "A"],
  [null, "1117C", "PROTEX MEMBRANA PVC", "Membrana de PVC.", "Rollo", "41 M2", "M2", 52395, "A"],
  [null, "Los productos vendidos en *CONTENEDOR* se facturan aparte.", null, null, null, null, null, null, null],
  [null, "PROKRETE ARGENTINA S.A. | LISTA DE PRECIOS SIN IVA", null, null, null, null, null, null, null],
  [null, "02. SELLADORES DE JUNTAS", null, null, null, null, null, null, null],
  [null, "CÓDIGO", "PRODUCTO", "DESCRIPCIÓN", "PRESENTACIÓN", null, "MIN. VENTA", "PRECIO", "TIPO"],
  [null, "108", "PROTEX POL 8 MM", "Fondo de junta.", "Rollo", "ML", "Por metro", 1715, "A"],
  [null, "187/21C", "PROTEX TOP ALIFATICO", "Barniz.", "Kit", "21 KG", "M2", 895671, "B"],
  // Protex repite una fila tal cual (JUE366C): tiene que quedar una sola.
  [null, "187/21C", "PROTEX TOP ALIFATICO", "Barniz.", "Kit", "21 KG", "M2", 895671, "B"],
  [null, "999", "PRODUCTO SIN PRECIO", "No trae precio.", "Balde", "4 LTS", "1 Unidad", null, "A"],
  [null, "TIPO DE PRODUCTO", null, null, null, null, null, null, null],
  [null, "A", "PRODUCTOS DE STOCK", null, null, null, null, null, null],
  [null, "B", "PRODUCTOS A PEDIDO", null, null, null, null, null, null],
];

describe("lectura de la planilla", () => {
  const result = analyzeWorkbook([{ sheet: "LISTA LOCAL", data: protexLike }, { sheet: "Hoja1", data: [["Codigo", "Producto", "AR$ Und. Venta"]] }], { fileName: "lista.xlsx" });

  it("encuentra la hoja, los títulos, la vigencia y que viene sin IVA", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout).toMatchObject({ sheet: "LISTA LOCAL", headerRow: 5, columns: { code: 1, name: 2, description: 3, presentation: 4, minSale: 6, price: 7, kind: 8 } });
    expect(result.source).toBe("auto");
    expect(result.validFrom).toBe("2026-09-02");
    expect(result.pricesIncludeVat).toBe(false);
  });

  it("arma un producto por fila con precio, con rubro, subrubro y el tamaño de la columna sin título", () => {
    if (!result.ok) throw new Error("no se leyó");
    const { items, skipped, legend } = result.parsed;
    expect(items.map(item => item.code)).toEqual(["5000PU20", "5000PU5", "1117C", "108", "187/21C"]);
    expect(items[0]).toMatchObject({ name: "TECHOS 5000 PU", description: "Membrana líquida poliuretánica.", presentation: "Balde 20 KG", category: "Impermeabilizantes", subcategory: "Impermeabilizantes para cubiertas", kind: "A", listPriceCents: 23_455_600 });
    // La fila que sólo trae otro tamaño hereda nombre, descripción y envase.
    expect(items[1]).toMatchObject({ name: "TECHOS 5000 PU", description: "Membrana líquida poliuretánica.", presentation: "Balde 5 KG" });
    // El aviso en minúsculas y el membrete repetido no son rubros; el rubro numerado reinicia el subrubro.
    expect(items[3]).toMatchObject({ category: "Selladores de juntas", subcategory: "" });
    expect(skipped).toEqual([{ row: 18, text: "999 · PRODUCTO SIN PRECIO · No trae precio. · Balde · 4 LTS · 1 Unidad · A" }]);
    expect(legend).toEqual({ A: "Productos de stock", B: "Productos a pedido" });
  });

  it("sin títulos reconocibles pide que se marquen, y con las columnas marcadas lee igual", () => {
    const odd: unknown[][] = [["Art.", "Detalle del artículo", "$ oct"], ["A1", "Látex interior 20 l", "$ 45.000,50"]];
    expect(analyzeWorkbook([{ sheet: "Precios", data: odd }]).ok).toBe(false);
    const manual = analyzeWorkbook([{ sheet: "Precios", data: odd }], { manual: { sheet: "Precios", headerRow: 0, columns: { code: 0, name: 1, price: 2 } } });
    expect(manual.ok && manual.source).toBe("manual");
    expect(manual.ok && manual.parsed.items[0]).toMatchObject({ code: "A1", name: "Látex interior 20 l", listPriceCents: 4_500_050 });
  });
});

describe("precios y medidas", () => {
  it("entiende los precios como se escriben", () => {
    expect(parsePrice(217025)).toBe(217025);
    expect(parsePrice("$ 217.025,50")).toBe(217025.5);
    expect(parsePrice("217.025")).toBe(217025);
    expect(parsePrice("1,234.50")).toBe(1234.5);
    expect(parsePrice("12,5")).toBe(12.5);
    expect(parsePrice("PRECIO")).toBe(0);
    expect(parsePrice(null)).toBe(0);
  });

  it("saca la medida del envase o del mínimo de venta, y no inventa cuando se contradicen", () => {
    expect(measureOf("Balde 20 KG", "1 Unidad")).toEqual({ qty: 20, unit: "kg" });
    expect(measureOf("Bidón 5 LTS", "3 Unidades")).toEqual({ qty: 5, unit: "litro" });
    expect(measureOf("Rollo 50 m 2", "1 Rollo")).toEqual({ qty: 50, unit: "m2" });
    expect(measureOf("Doypack 0.600 KG", "1 Unidad")).toEqual({ qty: 0.6, unit: "kg" });
    // Se vende por m²: el precio ya es por m², aunque el rollo traiga 41.
    expect(measureOf("Rollo 41 M2", "M2")).toEqual({ qty: 1, unit: "m2" });
    expect(measureOf("Rollo ML", "Por metro")).toEqual({ qty: 1, unit: "metro" });
    // Un kit de 21 kg que se vende "por M2": mejor no calcular nada.
    expect(measureOf("Kit 21 KG", "M2")).toBeNull();
    // "ML" es metro lineal o mililitro según el producto: no se compara.
    expect(measureOf("Cartucho 300ML", "1 Unidad")).toBeNull();
  });

  it("descuento e IVA", () => {
    expect(discounted(29_091_00, 15)).toBe(24_727_35);
    expect(withVat(discounted(29_091_00, 15))).toBe(29_920_09);
  });

  it("compara con la lista anterior por código y presentación", () => {
    const previous = [
      { code: "A", name: "Uno", presentation: "Balde 20 KG", listPriceCents: 1000 },
      { code: "A", name: "Uno", presentation: "Balde 5 KG", listPriceCents: 400 },
      { code: "B", name: "Dos", presentation: "Rollo", listPriceCents: 500 },
      { code: "C", name: "Tres", presentation: "", listPriceCents: 300 },
    ];
    const next = [
      { code: "A", name: "Uno", presentation: "Balde 20 KG", listPriceCents: 1100 },
      { code: "A", name: "Uno", presentation: "Balde 5 KG", listPriceCents: 400 },
      // El proveedor corrigió cómo escribe el envase: con código único alcanza.
      { code: "B", name: "Dos", presentation: "Rollo 10 M2", listPriceCents: 450 },
      { code: "D", name: "Nuevo", presentation: "", listPriceCents: 900 },
    ];
    expect(compareLists(previous, next)).toEqual({ previous: [1000, 400, 500, undefined], summary: { total: 4, added: 1, up: 1, down: 1, same: 1, removed: 1 } });
  });

  it("dos filas escritas igual se cruzan una con cada una: subir la misma lista no da bajas", () => {
    const twice = [{ code: "J", name: "Epoxi", presentation: "Kit", listPriceCents: 100 }, { code: "J", name: "Epoxi", presentation: "Kit", listPriceCents: 100 }];
    expect(compareLists(twice, twice).summary).toEqual({ total: 2, added: 0, up: 0, down: 0, same: 2, removed: 0 });
  });

  it("marca lo más barato por kilo, y sin medida entre los que se llaman igual", () => {
    const rows = markBest([
      { name: "Techos 5000", presentation: "Balde 20 KG", ownCents: 200_000, measure: { qty: 20, unit: "kg" as const } },
      { name: "Techos 5000", presentation: "Balde 5 KG", ownCents: 60_000, measure: { qty: 5, unit: "kg" as const } },
      { name: "Pistola", presentation: "Unidad", ownCents: 90_000, measure: null },
      { name: "pistola", presentation: "unidad", ownCents: 80_000, measure: null },
      { name: "Otra cosa", presentation: "", ownCents: 1, measure: null },
    ]);
    expect(rows.map(row => row.best)).toEqual([true, false, false, true, false]);
  });

  it("no premia a lo que sólo apareció por la descripción", () => {
    const membrane = { name: "Techos 5000", presentation: "Balde 20 KG", ownCents: 200_000, measure: { qty: 20, unit: "kg" as const } };
    const fibrado = { name: "Techos fibrado", presentation: "Balde 20 KG", ownCents: 120_000, measure: { qty: 20, unit: "kg" as const } };
    const mortar = { name: "Seal 77 flex (para techos)", presentation: "Kit 25 KG", ownCents: 50_000, measure: { qty: 25, unit: "kg" as const } };
    const rows = markBest([membrane, fibrado, mortar], row => row !== mortar);
    expect(rows.map(row => row.best)).toEqual([false, true, false]);
  });
});

/* ── Contra la base ────────────────────────────────────────────────────────── */

const session = { userId: new Types.ObjectId().toHexString(), name: "Compras de prueba", email: "compras@test.local", role: "gerencia" as const, permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session }));

const { Supplier, PriceList, PriceListItem } = await import("../src/lib/models");
const service = await import("../src/lib/price-list-service");
const discountRoute = await import("../src/app/api/suppliers/[id]/route");
const searchRoute = await import("../src/app/api/prices/search/route");
const historyRoute = await import("../src/app/api/prices/[id]/history/route");

let server: MongoMemoryServer;
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });

function item(code: string, name: string, presentation: string, pesos: number, extra: Partial<ParsedPriceItem> = {}): ParsedPriceItem {
  return { row: 0, code, name, description: "", presentation, minSale: "1 Unidad", category: "Impermeabilizantes", subcategory: "", kind: "A", listPriceCents: pesos * 100, ...extra };
}

async function importList(supplierId: string, validFrom: string, items: ParsedPriceItem[], pricesIncludeVat = false) {
  return service.saveImport({
    supplierId, items, layout: { sheet: "Lista", headerRow: 0, columns: { name: 0, price: 1 } }, legend: { A: "Productos de stock" },
    validFrom: new Date(`${validFrom}T00:00:00.000Z`), pricesIncludeVat, fileName: "lista.xlsx", file: "", session, rememberLayout: false,
  });
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("listas");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("listas de precios (base)", () => {
  it("importa, reemplaza sin borrar la anterior, busca entre proveedores y aplica el descuento", async () => {
    const protex = await Supplier.create({ name: "Protex", discountPct: 15 });
    const other = await Supplier.create({ name: "Otro corralón" });
    const protexId = String(protex._id);

    const first = await importList(protexId, "2026-07-01", [item("5000PU20", "TECHOS 5000 PU", "Balde 20 KG", 200_000), item("5000PU5", "TECHOS 5000 PU", "Balde 5 KG", 60_000), item("OLD", "DISCONTINUADO", "Balde", 1_000)]);
    expect(first.summary).toMatchObject({ total: 3, added: 3 });

    const second = await importList(protexId, "2026-09-02", [item("5000PU20", "TECHOS 5000 PU", "Balde 20 KG", 234_556), item("5000PU5", "TECHOS 5000 PU", "Balde 5 KG", 62_837), item("NEW", "TECHOS FIBRADO", "Balde 20 KG", 146_905)]);
    expect(second.summary).toEqual({ total: 3, added: 1, up: 2, down: 0, same: 0, removed: 1 });
    // La otra lista viene con IVA: se guarda sin IVA para poder comparar.
    await importList(String(other._id), "2026-09-10", [item("T5", "Techos 5000 PU blanco", "Balde 20 KG", 290_400)], true);

    expect(await PriceList.countDocuments({ supplierId: protex._id })).toBe(2);
    expect(await PriceList.countDocuments({ supplierId: protex._id, current: true })).toBe(1);
    expect(await PriceListItem.countDocuments({ supplierId: protex._id })).toBe(6);
    expect(await PriceListItem.countDocuments({ supplierId: protex._id, current: true })).toBe(3);

    // Una lista más vieja que la vigente no entra.
    await expect(importList(protexId, "2026-08-01", [item("X", "X", "", 1)])).rejects.toBeInstanceOf(service.PriceListConflict);

    const search = await call(await searchRoute.GET(new Request("http://test/api/prices/search?q=5000 techos")));
    expect(search.status).toBe(200);
    expect(search.body.total).toBe(3);
    const rows = search.body.rows as Array<{ supplierName: string; presentation: string; listCents: number; ownCents: number; previousCents: number | null; measure: { qty: number; unit: string } | null; best: boolean; kindLabel: string }>;
    const big = rows.find(row => row.supplierName === "Protex" && row.presentation === "Balde 20 KG")!;
    expect(big).toMatchObject({ listCents: 23_455_600, ownCents: 19_937_260, previousCents: 20_000_000, measure: { qty: 20, unit: "kg" }, kindLabel: "Productos de stock" });
    const competitor = rows.find(row => row.supplierName === "Otro corralón")!;
    expect(competitor).toMatchObject({ listCents: 24_000_000, ownCents: 24_000_000 });
    // Por kilo lo más barato es el balde de 20 de Protex con el 15 % aplicado.
    expect(rows.filter(row => row.best)).toEqual([big]);

    // Sin acentos ni mayúsculas, y el código exacto va primero.
    const byCode = await call(await searchRoute.GET(new Request("http://test/api/prices/search?q=5000pu5")));
    expect(byCode.body.rows[0]).toMatchObject({ code: "5000PU5" });
    const empty = await call(await searchRoute.GET(new Request("http://test/api/prices/search?q=")));
    expect(empty.body).toMatchObject({ rows: [], total: 0, lists: 2 });

    // El descuento se cambia en un lugar y se ve en todos los precios.
    const patched = await call(await discountRoute.PATCH(new Request("http://test", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ discountPct: 10 }) }), params({ id: protexId })));
    expect(patched).toEqual({ status: 200, body: { discountPct: 10 } });
    const invalid = await call(await discountRoute.PATCH(new Request("http://test", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ discountPct: 120 }) }), params({ id: protexId })));
    expect(invalid.status).toBe(400);
    const page = await service.supplierPrices(protexId);
    expect(page?.supplier.discountPct).toBe(10);
    expect(page?.lists).toHaveLength(2);
    expect(page?.items.find(row => row.code === "5000PU20")?.ownCents).toBe(21_110_040);

    // La historia del producto: el precio de cada lista, de la más vieja a la vigente.
    const history = await call(await historyRoute.GET(new Request("http://test"), params({ id: page!.items.find(row => row.code === "5000PU20")!._id })));
    expect(history.body.items.map((entry: { listCents: number; current: boolean }) => [entry.listCents, entry.current])).toEqual([[20_000_000, false], [23_455_600, true]]);
  });

  it("un proveedor dado de baja no aparece en el buscador", async () => {
    const gone = await Supplier.create({ name: "Proveedor inactivo", active: false });
    await importList(String(gone._id), "2026-09-01", [item("ZZZ", "PRODUCTO UNICO DE BAJA", "Balde", 10)]);
    const search = await call(await searchRoute.GET(new Request("http://test/api/prices/search?q=unico de baja")));
    expect(search.body.total).toBe(0);
  });
});
