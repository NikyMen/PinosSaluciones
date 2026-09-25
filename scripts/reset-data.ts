import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectDB } from "../src/lib/db";
import {
  AuditLog, CalendarBooking, CashMovement, Check, Client, Collection, Counter, Expense, Invoice, Notification,
  Payment, PriceList, PriceListItem, Purchase, Quote, StockItem, Supplier, Task, Work, WorkInspection, Worker,
} from "../src/lib/models";

/*
 * Borra los datos de prueba y deja el sistema vacío para empezar a usarlo en
 * serio. Quedan los usuarios (con sus permisos y contraseñas) y la conexión
 * con Google Calendar; se va todo lo demás: clientes, cotizaciones, obras,
 * personal, proveedores y sus listas, stock, compras, facturación, tareas,
 * avisos y el historial de cambios.
 *
 * Por defecto sólo muestra qué borraría. Para borrar de verdad:
 *   pnpm data:reset --confirmar
 * Opcional:
 *   --cotizaciones-desde=748   la próxima cotización sale COT-748
 *   --ordenes-desde=641        la próxima orden de compra sale OC-641
 *   --con-archivos             borra también los archivos subidos (fotos, PDF, Excel)
 */

function arg(name: string) {
  const hit = process.argv.find(value => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const collections = [
  ["Clientes", Client], ["Cotizaciones", Quote], ["Obras", Work], ["Inspecciones de obra", WorkInspection], ["Personal", Worker],
  ["Proveedores", Supplier], ["Listas de precios", PriceList], ["Productos de listas de precios", PriceListItem],
  ["Stock", StockItem], ["Órdenes de compra", Purchase], ["Compras y gastos", Expense], ["Facturación", Invoice],
  ["Cobranzas", Collection], ["Pagos", Payment], ["Cheques", Check], ["Caja y bancos", CashMovement], ["Tareas", Task],
  ["Turnos del calendario", CalendarBooking], ["Avisos", Notification], ["Historial de cambios", AuditLog], ["Contadores (numeración)", Counter],
] as const;

function startFrom(value: string | undefined, label: string) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`--${label} tiene que ser un número entero mayor a 0`);
  return number;
}

async function main() {
  const nextQuote = startFrom(arg("cotizaciones-desde"), "cotizaciones-desde");
  const nextOrder = startFrom(arg("ordenes-desde"), "ordenes-desde");
  await connectDB();
  console.log(`Base: ${mongoose.connection.name} @ ${mongoose.connection.host}\n`);

  let total = 0;
  for (const [label, model] of collections) {
    const count = await model.countDocuments();
    total += count;
    console.log(`  ${label.padEnd(34)} ${String(count).padStart(6)}`);
  }
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), ".uploads");
  const files = await readdir(uploadDir).catch(() => [] as string[]);
  console.log(`\n  Archivos subidos en ${uploadDir}: ${files.length}${has("con-archivos") ? " (se borran)" : " (quedan; con --con-archivos se borran)"}`);
  console.log(`\nQuedan: los usuarios y la conexión con Google Calendar.`);

  if (!has("confirmar")) {
    console.log(`\nNo se borró nada. Para borrar estos ${total} registros:\n  pnpm data:reset --confirmar\n`);
    process.exit(0);
  }

  for (const [label, model] of collections) {
    const { deletedCount } = await model.deleteMany({});
    console.log(`  Borrados ${String(deletedCount).padStart(6)} · ${label}`);
  }
  // La numeración arranca donde se pida (por ejemplo, después de la última cotización del sistema anterior).
  if (nextQuote) await Counter.updateOne({ _id: "quotes" }, { $set: { seq: nextQuote - 1 } }, { upsert: true });
  if (nextOrder) await Counter.updateOne({ _id: "purchases" }, { $set: { seq: nextOrder - 1 } }, { upsert: true });
  if (has("con-archivos")) {
    for (const file of files) await rm(path.join(uploadDir, file), { force: true, recursive: true });
    console.log(`  Borrados ${files.length} archivos subidos`);
  }
  console.log(`\nListo: el sistema quedó vacío.${nextQuote ? ` La próxima cotización es COT-${nextQuote}.` : ""}${nextOrder ? ` La próxima orden de compra es OC-${nextOrder}.` : ""}`);
  process.exit(0);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
