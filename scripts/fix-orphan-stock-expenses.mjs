import mongoose from "mongoose";

/**
 * Anula los gastos que generaron las entregas en obra de materiales que ya no
 * existen (se borraron del stock antes de que la papelera guardara la marca).
 * Esos gastos seguían sumando en el margen neto.
 *
 * Sin --apply solo muestra lo que encontraría. Se puede correr las veces que haga falta.
 *   node --env-file=.env scripts/fix-orphan-stock-expenses.mjs
 *   node --env-file=.env scripts/fix-orphan-stock-expenses.mjs --apply
 */
const uri = process.env.MONGODB_URI?.trim();
if (!uri) throw new Error("Falta MONGODB_URI");
const apply = process.argv.includes("--apply");

await mongoose.connect(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
const db = mongoose.connection;

// Los gastos que todavía tienen su material, en el stock o en la papelera.
const [inStock, inTrash] = await Promise.all([
  db.collection("stockitems").distinct("movements.expenseId"),
  db.collection("stocktrashes").distinct("item.movements.expenseId"),
]);
const linked = [...inStock, ...inTrash].filter(Boolean);

const orphans = await db.collection("expenses").find({
  _id: { $nin: linked },
  category: "materiales",
  description: { $regex: / entregados en obra \(/ },
  status: { $ne: "anulado" },
}).toArray();

const total = orphans.reduce((sum, expense) => sum + Number(expense.amountCents || 0), 0);
for (const expense of orphans) console.log(`- ${expense.number || "s/n"} · ${expense.description} · $ ${(Number(expense.amountCents || 0) / 100).toFixed(2)}`);
console.log(`[gastos] ${orphans.length} gastos de materiales borrados, por $ ${(total / 100).toFixed(2)}`);

if (apply && orphans.length) {
  await db.collection("expenses").updateMany({ _id: { $in: orphans.map(expense => expense._id) } }, { $set: { status: "anulado", updatedAt: new Date() } });
  console.log("[gastos] anulados: ya no cuentan en el tablero ni en los reportes");
} else if (orphans.length) console.log("[gastos] no se cambió nada: corré de nuevo con --apply para anularlos");

await mongoose.disconnect();
