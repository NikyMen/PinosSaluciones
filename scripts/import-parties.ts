import { readFileSync } from "node:fs";
import { readSheet } from "read-excel-file/node";
import { connectDB } from "../src/lib/db";
import { Client, Supplier } from "../src/lib/models";

// Carga el listado de proveedores o de clientes exportado de TANGO (anexo de
// Tesorería v5.1): razón social (columna "Razón social", "Proveedor" o
// "Cliente"), nombre de fantasía y CUIT/CUIL, y si vienen, el domicilio y el
// correo. Cada renglón se busca por CUIT y, si no lo encuentra, por razón social
// (sin importar mayúsculas, acentos ni puntos): al que ya existe se le completa
// lo que le falta (no se pisa lo cargado, salvo --overwrite); el que no está se
// da de alta y recibe su código. El renglón sin CUIT también se carga (por
// razón social); si trae un DNI, queda en las notas, porque ARCA factura con
// CUIT. Los códigos de TANGO no se usan: el sistema numera solo (lo pidió
// Administración). Sin --apply solo muestra lo que haría.
// pnpm parties:import <planilla.xlsx|.csv> --proveedores|--clientes [--apply] [--overwrite]
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const overwrite = args.includes("--overwrite");
const kind = args.includes("--clientes") ? "clientes" : args.includes("--proveedores") ? "proveedores" : "";
const file = args.find(arg => !arg.startsWith("--"));

const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const formatCuit = (value: string) => `${value.slice(0, 2)}-${value.slice(2, 10)}-${value.slice(10)}`;
const cuitOk = (value: string) => {
  const sum = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2].reduce((total, weight, index) => total + weight * Number(value[index]), 0);
  const check = 11 - (sum % 11);
  return (check === 11 ? 0 : check === 10 ? 9 : check) === Number(value[10]);
};

/** Las filas de la planilla: xlsx o csv (con ; o ,). */
async function rows(path: string): Promise<unknown[][]> {
  if (/\.csv$/i.test(path)) {
    const text = readFileSync(path, "utf8").replace(/^﻿/, "");
    const separator = (text.split(/\r?\n/)[0].match(/;/g)?.length || 0) >= (text.split(/\r?\n/)[0].match(/,/g)?.length || 0) ? ";" : ",";
    return text.split(/\r?\n/).filter(line => line.trim()).map(line => line.split(separator).map(cell => cell.replace(/^"|"$/g, "").trim()));
  }
  return readSheet(path);
}

type Party = Record<string, unknown> & { _id?: unknown; name: string; cuit?: string };

async function main() {
  if (!file || !kind) throw new Error("Uso: pnpm parties:import <planilla.xlsx|.csv> --proveedores|--clientes [--apply]");
  const matrix = await rows(file);
  const headers = matrix[0].map(normalize);
  const column = (...names: string[]) => headers.findIndex(header => names.some(name => header === name || header.startsWith(name)));
  const nameAt = column("RAZONSOCIAL", "NOMBRE", "DESCRIPCION", "PROVEEDOR", "CLIENTE");
  const tradeAt = column("NOMBREDEFANTASIA", "FANTASIA", "NOMBREFANTASIA");
  const cuitAt = column("CUIT", "NRODOCUMENTO", "NUMERODEDOCUMENTO");
  const addressAt = column("DOMICILIO", "DIRECCION");
  const emailAt = column("EMAIL", "CORREO", "EMAIL1");
  if (nameAt < 0 || cuitAt < 0) throw new Error(`La planilla tiene que tener las columnas Razón social y CUIT (encontré: ${matrix[0].join(", ")})`);

  await connectDB();
  const model = kind === "proveedores" ? Supplier : Client;
  // Todos en memoria: se buscan por CUIT o por razón social, y así los repetidos de la planilla no se dan de alta dos veces.
  const parties: Party[] = await model.find().lean<Party[]>();
  const byCuit = (cuit: string) => parties.find(party => digits(party.cuit) === cuit);
  const byName = (name: string) => parties.find(party => normalize(party.name) === normalize(name));
  let created = 0, updated = 0, same = 0, skipped = 0;
  const warnings: string[] = [];
  for (const row of matrix.slice(1)) {
    const name = String(row[nameAt] ?? "").replace(/^"+|"+$/g, "").trim();
    const doc = digits(row[cuitAt]);
    if (!name) { skipped++; continue; }
    const cuit = doc.length === 11 ? doc : "";
    const data: Record<string, string> = { name };
    if (cuit) {
      data.cuit = formatCuit(cuit);
      if (!cuitOk(cuit)) warnings.push(`CUIT con el dígito verificador mal: ${data.cuit} · ${name}`);
    } else if (doc.length >= 7 && doc.length <= 8) data.notes = `DNI ${doc}`;
    if (tradeAt >= 0 && String(row[tradeAt] ?? "").trim()) data.tradeName = String(row[tradeAt]).trim();
    if (addressAt >= 0 && String(row[addressAt] ?? "").trim()) data.address = String(row[addressAt]).trim();
    if (emailAt >= 0 && String(row[emailAt] ?? "").trim()) data.email = String(row[emailAt]).trim();

    // Por CUIT; si no, por razón social, siempre que el de la base no tenga otro CUIT.
    const sameCuit = cuit ? byCuit(cuit) : undefined;
    const sameName = byName(name);
    const existing = sameCuit ?? (sameName && (!cuit || !digits(sameName.cuit)) ? sameName : undefined);
    if (sameCuit && normalize(sameCuit.name) !== normalize(name)) warnings.push(`CUIT repetido: ${data.cuit} es "${sameCuit.name}" y también "${name}" (queda el primero)`);
    if (!existing) {
      created++;
      console.log(`nuevo      ${data.cuit ?? "sin CUIT     "} · ${name}${data.tradeName ? ` (${data.tradeName})` : ""}`);
      const party: Party = apply ? (await model.create(kind === "clientes" ? { ...data, phones: [] } : data)).toObject() : { ...data };
      parties.push(party);
      continue;
    }
    // Sólo lo que falta, salvo --overwrite. La razón social de TANGO manda si se pide pisar.
    const changes = Object.fromEntries(Object.entries(data).filter(([key, value]) => value && String(existing[key] ?? "") !== value && (overwrite || !existing[key])));
    if (!Object.keys(changes).length) { same++; continue; }
    updated++;
    console.log(`completa   ${data.cuit ?? "sin CUIT     "} · ${existing.name} → ${Object.keys(changes).join(", ")}`);
    Object.assign(existing, changes);
    if (apply && existing._id) await model.updateOne({ _id: existing._id }, { $set: changes });
  }
  if (warnings.length) console.log(`\nPara revisar:\n${warnings.map(line => `  ${line}`).join("\n")}`);
  console.log(`\n${created} nuevos, ${updated} para completar, ${same} sin cambios, ${skipped} renglones sin razón social.`);
  console.log(apply ? "Listo." : "No se cambió nada: corré con --apply para hacerlo.");
  process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
