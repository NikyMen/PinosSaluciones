import { readFileSync } from "node:fs";
import { connectDB } from "../src/lib/db";
import { CashAccount } from "../src/lib/models";
import { cashAccountKey } from "../src/lib/cash-accounts";
import { cashAccountCompanyShort, type CashAccountType } from "../src/lib/cash-account-kinds";

// Carga el maestro de cajas y cuentas con los códigos acordados con
// Administración el 28/10/2026 (docs/decisiones/2026-10-cajas-con-codigo.md).
// Una cuenta que ya existe se reconoce por el código, por el nombre (sin
// mayúsculas ni acentos) o por el mapa, y se le completa el código, la empresa,
// el tipo y la moneda, sin cambiarle el nombre; la que no está se da de alta.
// Las que ya había y no entran en la lista quedan como están (se avisan).
// Sin --apply solo muestra lo que haría.
// pnpm cash:codes [--apply] [--map mapa.json]
//   mapa.json: { "nombre de una cuenta que ya existe": código } para las que se
//   llaman distinto ("Bco Nación" → 33).
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const mapIndex = args.indexOf("--map");
const map: Record<string, number> = mapIndex >= 0 ? JSON.parse(readFileSync(args[mapIndex + 1], "utf8")) : {};

type Planned = { code: number; name: string; company: "tvp" | "constructora" | "ambas"; type: CashAccountType; currency?: "ARS" | "USD" | "BRL" | "EUR"; bank?: string; bankCode?: number };

const tvpBanks: Array<[number, string, string]> = [
  [30, "Banco Corrientes Sub-Cuenta 1", "Banco de Corrientes"], [31, "Banco Corrientes Sub-Cuenta 2", "Banco de Corrientes"],
  [32, "Banco Macro", "Banco Macro"], [33, "Banco Nación", "Banco de la Nación Argentina"], [34, "Banco Santander", "Banco Santander"],
];

const PLAN: Planned[] = [
  { code: 1, name: "Mercado Pago Constructora", company: "constructora", type: "billetera" },
  { code: 6, name: "Mercado Pago TV Pino", company: "tvp", type: "billetera" },
  { code: 10, name: "Banco Corrientes Constructora", company: "constructora", type: "cuenta_corriente", bank: "Banco de Corrientes" },
  { code: 20, name: "Cheques diferidos Banco Corrientes Constructora", company: "constructora", type: "cheques_diferidos", bank: "Banco de Corrientes", bankCode: 10 },
  ...tvpBanks.map(([code, name, bank]): Planned => ({ code, name: `${name} TV Pino`, company: "tvp", type: "cuenta_corriente", bank })),
  ...tvpBanks.map(([code, name, bank]): Planned => ({ code: code + 10, name: `Cheques diferidos ${name} TV Pino`, company: "tvp", type: "cheques_diferidos", bank, bankCode: code })),
  { code: 50, name: "Caja Efectivo", company: "ambas", type: "caja" },
  { code: 51, name: "Caja Dólares", company: "ambas", type: "caja", currency: "USD" },
  { code: 52, name: "Caja Reales", company: "ambas", type: "caja", currency: "BRL" },
  { code: 53, name: "Caja Euros", company: "ambas", type: "caja", currency: "EUR" },
  { code: 54, name: "Caja Salón de Ventas", company: "ambas", type: "caja" },
  { code: 60, name: "Valores al Cobro Constructora", company: "constructora", type: "valores_cobro" },
  { code: 61, name: "Tarjetas de crédito Constructora", company: "constructora", type: "tarjeta_credito" },
  { code: 62, name: "Retenciones Constructora", company: "constructora", type: "retenciones" },
  { code: 70, name: "Valores al Cobro TV Pino", company: "tvp", type: "valores_cobro" },
  { code: 71, name: "Tarjetas de crédito TV Pino", company: "tvp", type: "tarjeta_credito" },
  { code: 72, name: "Retenciones TV Pino", company: "tvp", type: "retenciones" },
];

type Existing = { _id: unknown; code?: number; name: string; nameKey: string; company: string; type: string; currency?: string };

async function main() {
  await connectDB();
  const existing = await CashAccount.find().lean<Existing[]>();
  const byMap = new Map(Object.entries(map).map(([name, code]) => [cashAccountKey(name), Number(code)]));
  const used = new Set<string>();
  const matchOf = (planned: Planned) => existing.find(account => !used.has(String(account._id)) && (account.code === planned.code || byMap.get(account.nameKey) === planned.code || account.nameKey === cashAccountKey(planned.name)));

  const ids = new Map<number, unknown>();
  for (const planned of PLAN) {
    const match = matchOf(planned);
    const fields = { code: planned.code, company: planned.company, type: planned.type, currency: planned.currency || "ARS", ...(planned.bank ? { bank: planned.bank } : {}) };
    const where = `${String(planned.code).padStart(2)} · ${cashAccountCompanyShort(planned.company).padEnd(17)}`;
    if (match) {
      used.add(String(match._id));
      ids.set(planned.code, match._id);
      const changes = Object.entries(fields).filter(([key, value]) => String(match[key as keyof Existing] ?? "") !== String(value)).map(([key]) => key);
      console.log(`${where} ${match.name}${match.name !== planned.name ? ` (ya existe; en la lista: ${planned.name})` : ""} → ${changes.length ? `completa ${changes.join(", ")}` : "sin cambios"}`);
      if (apply && changes.length) await CashAccount.updateOne({ _id: match._id }, { $set: fields });
    } else {
      console.log(`${where} ${planned.name} → nueva`);
      if (apply) ids.set(planned.code, (await CashAccount.create({ ...fields, name: planned.name, nameKey: cashAccountKey(planned.name) }))._id);
    }
  }

  // Cada cuenta de cheques diferidos, con el banco que los debita.
  if (apply) {
    for (const planned of PLAN.filter(item => item.bankCode)) {
      await CashAccount.updateOne({ _id: ids.get(planned.code) }, { $set: { bankAccountId: ids.get(planned.bankCode!) } });
    }
  }

  const left = existing.filter(account => !used.has(String(account._id)));
  if (left.length) {
    console.log(`\nQuedan ${left.length} cuentas que no están en la lista (no se tocan; si alguna es de la lista con otro nombre, pasala en --map; si no se usa más, inactivala):`);
    for (const account of left) console.log(`  ${account.code ?? "—"} · ${account.name} (${cashAccountCompanyShort(account.company)})`);
  }
  console.log(apply ? "\nListo." : "\nNo se cambió nada: corré con --apply para hacerlo.");
  process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
