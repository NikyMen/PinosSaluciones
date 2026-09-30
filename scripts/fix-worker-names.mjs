import mongoose from "mongoose";

/**
 * Completa el nombre ("APELLIDO, NOMBRE") del personal que se cargó con el CSV
 * sin armarlo, y el de sus partes y asignaciones en cada obra. Sin el nombre,
 * la liquidación de la quincena mostraba "Sin nombre".
 *
 * Sin --apply solo cuenta lo que arreglaría. Se puede correr las veces que haga falta.
 *   node --env-file=.env scripts/fix-worker-names.mjs
 *   node --env-file=.env scripts/fix-worker-names.mjs --apply
 */
const uri = process.env.MONGODB_URI?.trim();
if (!uri) throw new Error("Falta MONGODB_URI");
const apply = process.argv.includes("--apply");
const compose = worker => [worker.lastName, worker.firstName].filter(Boolean).map(String).join(", ");

await mongoose.connect(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
const db = mongoose.connection;

const workers = await db.collection("workers").find({}, { projection: { name: 1, firstName: 1, lastName: 1 } }).toArray();
const nameOf = new Map(workers.map(worker => [String(worker._id), worker.name || compose(worker)]));
const withoutName = workers.filter(worker => !worker.name && compose(worker));
console.log(`[personal] ${withoutName.length} de ${workers.length} sin nombre completo`);
if (apply) for (const worker of withoutName) await db.collection("workers").updateOne({ _id: worker._id }, { $set: { name: compose(worker) } });

let entries = 0; let assignments = 0; let works = 0;
for (const work of await db.collection("works").find({ $or: [{ "labor.person": { $in: [null, ""] } }, { "assignedWorkers.name": { $in: [null, ""] } }] }, { projection: { labor: 1, assignedWorkers: 1 } }).toArray()) {
  let changed = false;
  for (const entry of work.labor || []) if (!entry.person && nameOf.get(String(entry.workerId))) { entry.person = nameOf.get(String(entry.workerId)); entries++; changed = true; }
  for (const assigned of work.assignedWorkers || []) if (!assigned.name && nameOf.get(String(assigned.workerId))) { assigned.name = nameOf.get(String(assigned.workerId)); assignments++; changed = true; }
  if (changed) { works++; if (apply) await db.collection("works").updateOne({ _id: work._id }, { $set: { labor: work.labor, assignedWorkers: work.assignedWorkers } }); }
}
console.log(`[obras] ${entries} partes y ${assignments} asignaciones sin nombre, en ${works} obras`);
console.log(apply ? "[listo] nombres completados" : "[sin cambios] corré de nuevo con --apply para completarlos");
await mongoose.disconnect();
