import { readFileSync } from "node:fs";
import mongoose from "mongoose";
import readXlsxFile from "read-excel-file/node";
import { analyzeWorkbook, normalize, type WorkbookSheet } from "../src/lib/price-lists";

// Completa el precio final de la lista vigente sin volver a importarla ni alterar el costo.
// pnpm exec tsx --env-file=.env scripts/migrate-protex-consumer.ts --file lista.xlsx [--apply]
const args = process.argv.slice(2);
const fileIndex = args.indexOf("--file");
if (fileIndex < 0 || !args[fileIndex + 1]) throw new Error("Falta --file lista.xlsx");
const apply = args.includes("--apply");
const uri = process.env.MONGODB_URI?.trim();
if (!uri) throw new Error("Falta MONGODB_URI");

const sheets = await readXlsxFile(readFileSync(args[fileIndex + 1])) as unknown as WorkbookSheet[];
const parsed = analyzeWorkbook(sheets, { fileName: "LISTA PROTEX 092026 modificado.xlsx" });
if (!parsed.ok || parsed.source !== "headerless") throw new Error("No se reconoció el formato de Protex");
const source = parsed.parsed.items;
if (source.length !== 211 || source.some(item => !item.consumerGrossCents)) {
  throw new Error(`Planilla inesperada: ${source.length} productos o precios finales faltantes`);
}

const key = (name: string, price: number) => `${normalize(name)}\u0000${price}`;
const sourceByKey = new Map<string, number>();
for (const item of source) {
  const itemKey = key(item.name, item.listPriceCents);
  if (sourceByKey.has(itemKey)) throw new Error(`Producto repetido en la planilla: ${item.name}`);
  sourceByKey.set(itemKey, item.consumerGrossCents!);
}

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  if (!db) throw new Error("No se abrió la base");
  const suppliers = await db.collection("suppliers").find({ name: /^protex$/i }).toArray();
  if (suppliers.length !== 1) throw new Error(`Se esperaban un proveedor PROTEX; hay ${suppliers.length}`);
  const supplierId = suppliers[0]._id;
  const lists = await db.collection("pricelists").find({ supplierId, current: true }).toArray();
  if (lists.length !== 1) throw new Error(`Se esperaba una lista vigente; hay ${lists.length}`);
  const list = lists[0];
  const previousDate = new Date(list.validFrom).toISOString().slice(0, 10);
  if (!["2026-09-01", "2026-09-02"].includes(previousDate)) throw new Error(`Fecha de lista inesperada: ${previousDate}`);
  const current = await db.collection("pricelistitems").find({ supplierId, current: true }).toArray();
  if (current.length !== source.length) throw new Error(`La lista vigente tiene ${current.length} productos; la planilla tiene ${source.length}`);

  const matched = new Set<string>();
  const changes = [];
  for (const item of current) {
    if (!item.priceListId.equals(list._id)) throw new Error(`Producto de otra lista vigente: ${item.name}`);
    const itemKey = key(item.name, item.listPriceCents);
    const gross = sourceByKey.get(itemKey);
    if (gross === undefined || matched.has(itemKey)) throw new Error(`No coincide de forma única: ${item.name} (${item.listPriceCents})`);
    matched.add(itemKey);
    if (item.consumerGrossCents !== gross) changes.push({ _id: item._id, gross });
  }
  if (matched.size !== sourceByKey.size) throw new Error("Quedaron productos de la planilla sin asociar");
  const flex = current.find(item => normalize(item.name) === "protex flex");
  if (!flex || sourceByKey.get(key(flex.name, flex.listPriceCents)) !== 20927927) {
    throw new Error("PROTEX FLEX no coincide con $209.279,27");
  }

  console.log(`PROTEX: ${current.length} productos asociados, ${changes.length} precios finales por actualizar; vigencia ${previousDate} → 2026-09-01; FLEX $209.279,27`);
  if (apply) {
    if (changes.length) {
      const result = await db.collection("pricelistitems").bulkWrite(changes.map(item => ({
        updateOne: { filter: { _id: item._id, supplierId, current: true }, update: { $set: { consumerGrossCents: item.gross } } },
      })));
      if (result.modifiedCount !== changes.length) throw new Error(`Se actualizaron ${result.modifiedCount} de ${changes.length} productos`);
    }
    await db.collection("pricelists").updateOne({ _id: list._id, current: true }, { $set: { validFrom: new Date("2026-09-01T00:00:00.000Z") } });
    console.log("Actualización aplicada");
  } else {
    console.log("Modo prueba: no se modificaron datos");
  }
} finally {
  await mongoose.disconnect();
}
