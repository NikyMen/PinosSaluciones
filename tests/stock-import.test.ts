import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";

const session = { userId: new Types.ObjectId().toHexString(), name: "Cristian", email: "ventas@test.local", role: "gerencia" as const, permissions: defaultPermissionsForRole("gerencia") };
vi.mock("@/lib/auth", () => ({ requireSession: async () => session, getSession: async () => session, isOwnerEmail: () => false }));

const { StockItem, StockPriceChange } = await import("../src/lib/models");
const importRoute = await import("../src/app/api/import/[entity]/route");

let server: MongoMemoryServer;
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });

/** Sube una planilla CSV a la importación de Stock; con `preview`, sólo cuenta qué pasaría. */
async function upload(lines: string[], preview = false) {
  const form = new FormData();
  form.set("file", new File([`﻿sep=;\r\n${lines.join("\r\n")}\r\n`], "salon.csv", { type: "text/csv" }));
  return call(await importRoute.POST(new Request(`http://test/api/import/stock${preview ? "?preview=1" : ""}`, { method: "POST", body: form }), params({ entity: "stock" })));
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("stock-import");
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

describe("importación de Stock desde la planilla del Salón", () => {
  it("la plantilla trae las columnas de cantidad, depósito, empresa propietaria y costo", async () => {
    const template = await (await importRoute.GET(new Request("http://test"), params({ entity: "stock" }))).text();
    for (const header of ["Material", "Precio de venta sin IVA", "Cantidad", "Depósito", "Empresa propietaria", "Costo unitario"]) expect(template).toContain(header);
  });

  it("muestra antes qué va a pasar, da de alta lo nuevo en su depósito y actualiza lo que ya existe sin duplicarlo", async () => {
    // Ya está en Stock, con otro precio y 3 unidades en el Salón.
    const existing = await StockItem.create({ name: "Rodillo 22 cm", sku: "ROD-22", unit: "unidad", category: "herramientas", salePriceCents: 8_000_00, qty_salon: 3, quantity: 3, owners: { salon: { constructora: 3 } } });
    const sheet = [
      "Código;Producto;Unidad;Precio de venta sin IVA;Cantidad;Depósito;Empresa propietaria;Costo unitario",
      "rod-22;Rodillo 22 cm;unidad;9.500,00;5;Salón;Constructora;4.000,00",
      "LAT-20;Látex interior 20 l;balde;60.000,00;12;Salón de Ventas;;35.000,00",
      "PIN-20;Pincel N° 20;;2.500,00;;;;",
      "LAT-20;Látex repetido;balde;1,00;1;Salón;;",
      "FIJ-10;Fijador 10 l;balde;20.000,00;4;Depósito Rosario;;",
    ];

    // La vista previa no escribe nada.
    const preview = await upload(sheet, true);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ preview: true, total: 5, imported: 2, updated: 1, withStock: 2 });
    expect(preview.body.errors.map((row: { row: number }) => row.row)).toEqual([5, 6]);
    expect(await StockItem.countDocuments({})).toBe(1);
    expect(await StockItem.findById(existing._id).lean()).toMatchObject({ salePriceCents: 8_000_00, qty_salon: 3 });

    const done = await upload(sheet);
    expect(done.body).toMatchObject({ preview: false, imported: 2, updated: 1, withStock: 2 });
    expect(done.body.errors).toMatchObject([{ row: 5 }, { row: 6, error: expect.stringContaining("Depósito") }]);
    expect(await StockItem.countDocuments({})).toBe(3);

    // El que ya existía: mismo material (por código, sin importar mayúsculas), precio nuevo en el historial y lo contado en el Salón.
    const rodillo = await StockItem.findById(existing._id).lean<Record<string, unknown>>();
    expect(rodillo).toMatchObject({ sku: "ROD-22", salePriceCents: 9_500_00, qty_salon: 5, quantity: 5, avgCostCents: 4_000_00, valueCents: 20_000_00 });
    expect((rodillo!.owners as Record<string, unknown>).salon).toEqual({ constructora: 5 });
    expect(await StockPriceChange.findOne({ stockItemId: existing._id }).lean()).toMatchObject({ previousCents: 8_000_00, salePriceCents: 9_500_00, source: "importacion", userName: "Cristian" });

    // El nuevo entra al Salón a nombre de Constructora (la empresa de ese depósito) con su costo; el que no trae cantidad queda en el catálogo.
    const latex = await StockItem.findOne({ sku: "LAT-20" }).lean<Record<string, unknown>>();
    expect(latex).toMatchObject({ name: "Látex interior 20 l", unit: "balde", category: "materiales", salePriceCents: 60_000_00, qty_salon: 12, qty_central: 0, quantity: 12, avgCostCents: 35_000_00 });
    expect((latex!.owners as Record<string, unknown>).salon).toEqual({ constructora: 12 });
    expect(await StockItem.findOne({ sku: "PIN-20" }).lean()).toMatchObject({ unit: "unidad", salePriceCents: 2_500_00, quantity: 0 });

    // Volver a subir la misma planilla no duplica ni vuelve a mover el stock.
    const again = await upload(sheet.slice(0, 4));
    expect(again.body).toMatchObject({ imported: 0, updated: 3 });
    expect(await StockItem.countDocuments({})).toBe(3);
    expect((await StockItem.findOne({ sku: "LAT-20" }).lean<{ movements: unknown[] }>())!.movements).toHaveLength(1);
  });

  it("el precio final con IVA de la planilla se guarda sin IVA", async () => {
    const done = await upload(["Código;Descripción;Precio final", "ENT-01;Enduido 4 kg;12.100,00"]);
    expect(done.body).toMatchObject({ imported: 1, errors: [] });
    expect(await StockItem.findOne({ sku: "ENT-01" }).lean()).toMatchObject({ name: "Enduido 4 kg", salePriceCents: 10_000_00 });
  });
});
