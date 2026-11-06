import { readFileSync } from "node:fs";
import { readSheet } from "read-excel-file/node";
import { connectDB } from "../src/lib/db";
import { Client, Supplier } from "../src/lib/models";

// Carga el listado de proveedores o de clientes exportado de TANGO (anexo de
// Tesorería v5.1): razón social, nombre de fantasía y CUIT, y si vienen, el
// domicilio y el correo. Cada renglón se busca por CUIT: al que ya existe se le
// completa lo que le falta (no se pisa lo cargado, salvo --overwrite); el que no
// está se da de alta y recibe su código. Los códigos de TANGO no se usan: el
// sistema numera solo (lo pidió Administración). Sin --apply solo muestra lo que haría.
// pnpm parties:import <planilla.xlsx|.csv> --proveedores|--clientes [--apply] [--overwrite]
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const overwrite = args.includes("--overwrite");
const kind = args.includes("--clientes") ? "clientes" : args.includes("--proveedores") ? "proveedores" : "";
const file = args.find(arg => !arg.startsWith("--"));

const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const formatCuit = (value: string) => `${value.slice(0, 2)}-${value.slice(2, 10)}-${value.slice(10)}`;

/** Las filas de la planilla: xlsx o csv (con ; o ,). */
async function rows(path: string): Promise<unknown[][]> {
  if (/\.csv$/i.test(path)) {
    const text = readFileSync(path, "utf8").replace(/^﻿/, "");
    const separator = (text.split(/\r?\n/)[0].match(/;/g)?.length || 0) >= (text.split(/\r?\n/)[0].match(/,/g)?.length || 0) ? ";" : ",";
    return text.split(/\r?\n/).filter(line => line.trim()).map(line => line.split(separator).map(cell => cell.replace(/^"|"$/g, "").trim()));
  }
  return readSheet(path);
}

async function main() {
  if (!file || !kind) throw new Error("Uso: pnpm parties:import <planilla.xlsx|.csv> --proveedores|--clientes [--apply]");
  const matrix = await rows(file);
  const headers = matrix[0].map(normalize);
  const column = (...names: string[]) => headers.findIndex(header => names.some(name => header === name || header.startsWith(name)));
  const nameAt = column("RAZONSOCIAL", "NOMBRE", "DESCRIPCION");
  const tradeAt = column("NOMBREDEFANTASIA", "FANTASIA", "NOMBREFANTASIA");
  const cuitAt = column("CUIT", "NRODOCUMENTO", "NUMERODEDOCUMENTO");
  const addressAt = column("DOMICILIO", "DIRECCION");
  const emailAt = column("EMAIL", "CORREO", "EMAIL1");
  if (nameAt < 0 || cuitAt < 0) throw new Error(`La planilla tiene que tener las columnas Razón social y CUIT (encontré: ${matrix[0].join(", ")})`);

  await connectDB();
  const model = kind === "proveedores" ? Supplier : Client;
  let created = 0, updated = 0, same = 0, skipped = 0;
  for (const row of matrix.slice(1)) {
    const cuit = digits(row[cuitAt]);
    const name = String(row[nameAt] ?? "").trim();
    if (!name || cuit.length !== 11) { skipped++; continue; }
    const data: Record<string, string> = { name, cuit: formatCuit(cuit) };
    if (tradeAt >= 0 && String(row[tradeAt] ?? "").trim()) data.tradeName = String(row[tradeAt]).trim();
    if (addressAt >= 0 && String(row[addressAt] ?? "").trim()) data.address = String(row[addressAt]).trim();
    if (emailAt >= 0 && String(row[emailAt] ?? "").trim()) data.email = String(row[emailAt]).trim();
    const existing = await model.findOne({ cuit: { $in: [data.cuit, cuit] } }).lean<Record<string, unknown> & { _id: unknown }>();
    if (!existing) {
      created++;
      console.log(`nuevo      ${data.cuit} · ${name}${data.tradeName ? ` (${data.tradeName})` : ""}`);
      if (apply) await model.create(kind === "clientes" ? { ...data, phones: [] } : data);
      continue;
    }
    // Sólo lo que falta, salvo --overwrite. La razón social de TANGO manda si se pide pisar.
    const changes = Object.fromEntries(Object.entries(data).filter(([key, value]) => key !== "cuit" && value && String(existing[key] ?? "") !== value && (overwrite || !existing[key])));
    if (!Object.keys(changes).length) { same++; continue; }
    updated++;
    console.log(`completa   ${data.cuit} · ${String(existing.name)} → ${Object.keys(changes).join(", ")}`);
    if (apply) await model.updateOne({ _id: existing._id }, { $set: changes });
  }
  console.log(`\n${created} nuevos, ${updated} para completar, ${same} sin cambios, ${skipped} renglones sin razón social o CUIT.`);
  console.log(apply ? "Listo." : "No se cambió nada: corré con --apply para hacerlo.");
  process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
