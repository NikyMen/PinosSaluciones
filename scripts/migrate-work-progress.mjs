import mongoose from "mongoose";

/**
 * Pasa las obras al avance por inspecciones.
 *
 * Hasta ahora el avance se escribia a mano. Desde las inspecciones lo calcula el
 * sistema y cada obra dice de donde sale su numero (`progressMode`):
 *   - "manual": ya tenia avance cargado (o avances registrados). El numero se
 *     respeta tal cual hasta que se le cargue la base de avance; ahi conviene
 *     completar "Ya ejecutado" para que no vuelva a cero.
 *   - "sin_base": no tenia nada. Se muestra "Sin base de avance", no un 0%.
 * Los avances manuales (`advances`) no se tocan: quedan como registro anterior.
 *
 * Se puede correr las veces que haga falta: solo toca las obras sin `progressMode`.
 */
const uri = process.env.MONGODB_URI?.trim();
if (!uri) throw new Error("Falta MONGODB_URI");

await mongoose.connect(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
const works = mongoose.connection.collection("works");

const pending = await works.find({ progressMode: { $exists: false } }).project({ progress: 1, advances: 1 }).toArray();
let manual = 0;
let withoutBase = 0;
const now = new Date();

for (const work of pending) {
  const hasManual = Number(work.progress || 0) > 0 || (Array.isArray(work.advances) && work.advances.length > 0);
  await works.updateOne({ _id: work._id }, { $set: { progressMode: hasManual ? "manual" : "sin_base", progressUpdatedAt: now, ...(hasManual ? {} : { progress: 0 }) } });
  if (hasManual) manual += 1; else withoutBase += 1;
}

// Una inspeccion por obra, rubro y dia: el indice lo garantiza aunque dos personas carguen a la vez.
await mongoose.connection.collection("workinspections").createIndex({ workId: 1, rubro: 1, dayKey: 1 }, { unique: true });
await mongoose.connection.collection("workinspections").createIndex({ workId: 1, status: 1, dayKey: -1 });

console.log(`[migracion] ${pending.length} obras revisadas`);
console.log(`[migracion] ${manual} conservan su avance manual hasta que se les cargue la base de avance`);
console.log(`[migracion] ${withoutBase} quedan sin base de avance`);

await mongoose.disconnect();
