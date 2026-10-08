import { readFileSync } from "node:fs";
import mongoose from "mongoose";

/**
 * Arma el maestro de cajas y cuentas bancarias con los nombres que ya se usaron.
 *
 * Hasta ahora la caja o el banco de cada movimiento de caja, recibo y pago era
 * texto libre. Este script junta esos nombres, los agrupa sin mayúsculas, acentos
 * ni puntos ("Bco. Nación" y "bco nacion" son la misma), da de alta una cuenta
 * por grupo y le pone a cada movimiento su `cashAccountId`.
 *
 *   pnpm migrate:cash-accounts                 → sólo muestra lo que haría (no toca nada)
 *   pnpm migrate:cash-accounts --map mapa.json → además une nombres distintos que son la misma cuenta
 *   pnpm migrate:cash-accounts --apply         → lo hace
 *
 * El mapa es un JSON { "nombre como se escribió": "nombre de la cuenta del maestro" }, para
 * los que se escribieron tan distinto que no se agrupan solos ("Galicia" y "Banco Galicia TVP").
 * La empresa de cada cuenta es la que más aparece en sus movimientos (si no hay, TV Pino) y
 * el tipo sale del nombre; las dos cosas se corrigen después en Tesorería › Cajas y cuentas.
 * Se puede correr las veces que haga falta: sólo toca movimientos sin `cashAccountId`.
 */
const uri = process.env.MONGODB_URI?.trim();
if (!uri) throw new Error("Falta MONGODB_URI");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const mapIndex = args.indexOf("--map");
const map = mapIndex >= 0 ? JSON.parse(readFileSync(args[mapIndex + 1], "utf8")) : {};

const key = name => String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const mapped = Object.fromEntries(Object.entries(map).map(([from, to]) => [key(from), String(to)]));

function guessType(name) {
  const text = key(name);
  if (/\b(usd|dolar|dolares|u s s)\b/.test(text)) return "cuenta_dolares";
  if (/\bcaja de ahorro|\bca\b/.test(text)) return "caja_ahorro";
  if (/\bcaja\b|efectivo|chica/.test(text)) return "caja";
  if (/banco|bco|cta|cuenta|galicia|nacion|macro|santander|bbva|frances|provincia|credicoop|hsbc|icbc|patagonia|supervielle|corrientes|mercado pago|brubank|uala/.test(text)) return "cuenta_corriente";
  return "otra";
}

await mongoose.connect(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
const db = mongoose.connection;
const sources = [
  { collection: "cashmovements", label: "movimientos de caja" },
  { collection: "collections", label: "recibos" },
  { collection: "payments", label: "pagos" },
];

// Cada nombre usado, con cuántas veces y de qué empresa.
const groups = new Map();
for (const source of sources) {
  const rows = await db.collection(source.collection).aggregate([
    { $match: { account: { $nin: [null, ""] }, cashAccountId: { $exists: false } } },
    { $group: { _id: { account: "$account", company: "$company" }, count: { $sum: 1 } } },
  ]).toArray();
  for (const row of rows) {
    const name = String(row._id.account).trim();
    const groupKey = mapped[key(name)] ? key(mapped[key(name)]) : key(name);
    if (!groupKey) continue;
    const group = groups.get(groupKey) || { key: groupKey, target: mapped[key(name)], names: new Map(), companies: new Map(), total: 0 };
    group.names.set(name, (group.names.get(name) || 0) + row.count);
    if (row._id.company) group.companies.set(row._id.company, (group.companies.get(row._id.company) || 0) + row.count);
    group.total += row.count;
    groups.set(groupKey, group);
  }
}

const top = entries => [...entries].sort((a, b) => b[1] - a[1])[0]?.[0];
const existing = new Map((await db.collection("cashaccounts").find({}).toArray()).map(account => [account.nameKey, account]));
console.log(`[cajas] ${groups.size} cuentas distintas en los movimientos sin cuenta del maestro${apply ? "" : " (modo prueba: no se toca nada; para hacerlo, --apply)"}\n`);

let created = 0;
let linked = 0;
for (const group of [...groups.values()].sort((a, b) => b.total - a.total)) {
  const name = group.target || top(group.names);
  const company = top(group.companies) || "tvp";
  const already = existing.get(group.key);
  const variants = [...group.names].map(([variant, count]) => `"${variant}" (${count})`).join(", ");
  console.log(`- ${name} · ${company} · ${guessType(name)}${already ? " · ya existe en el maestro" : ""}\n    usado como: ${variants}`);
  if (!apply) continue;
  let account = already;
  if (!account) {
    const now = new Date();
    const result = await db.collection("cashaccounts").insertOne({ company, name, nameKey: group.key, type: guessType(name), currency: /dolar|usd/.test(group.key) ? "USD" : "ARS", active: true, openingBalanceCents: 0, notes: "Creada por la migración desde los nombres que se usaban", createdAt: now, updatedAt: now });
    account = { _id: result.insertedId, name };
    existing.set(group.key, account);
    created++;
  }
  for (const source of sources) {
    const result = await db.collection(source.collection).updateMany({ account: { $in: [...group.names.keys()] }, cashAccountId: { $exists: false } }, { $set: { cashAccountId: account._id, account: account.name } });
    linked += result.modifiedCount;
  }
}

if (apply) {
  await db.collection("cashaccounts").createIndex({ nameKey: 1 }, { unique: true });
  console.log(`\n[cajas] ${created} cuentas creadas, ${linked} movimientos atados a su cuenta`);
  console.log("[cajas] Revisá empresa, tipo, banco y saldo inicial de cada una en Tesorería › Cajas y cuentas bancarias");
}
await mongoose.disconnect();
