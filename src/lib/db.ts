import mongoose from "mongoose";

type Cache = { connection: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalMongo = globalThis as typeof globalThis & { mongooseCache?: Cache };
const cache = globalMongo.mongooseCache ?? { connection: null, promise: null };
globalMongo.mongooseCache = cache;

/*
 * Índices que cambiaron de forma. Mongoose crea los nuevos solo, pero no borra
 * los viejos: si quedan, siguen bloqueando lo que el índice nuevo ya permite.
 */
const OBSOLETE_INDEXES: Array<[collection: string, index: string]> = [
  // Facturas: antes era único número + cliente; ahora es empresa + tipo + número + cliente.
  ["invoices", "number_1_clientId_1"],
];

let indexesChecked = false;
async function upgradeIndexes(connection: typeof mongoose) {
  if (indexesChecked) return;
  indexesChecked = true;
  const db = connection.connection.db;
  if (!db) return;
  for (const [collection, index] of OBSOLETE_INDEXES) {
    try {
      const existing = await db.collection(collection).indexes();
      if (existing.some(item => item.name === index)) await db.collection(collection).dropIndex(index);
    } catch { /* la colección todavía no existe: no hay nada que sacar */ }
  }
}

export async function connectDB() {
  const MONGODB_URI = process.env.MONGODB_URI?.trim();
  if (!MONGODB_URI) throw new Error("Falta configurar MONGODB_URI");
  if (cache.connection) return cache.connection;
  if (!cache.promise) {
    cache.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      maxPoolSize: 15,
      serverSelectionTimeoutMS: Math.max(1000, Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 5000)),
    }).catch(error => {
      cache.promise = null;
      cache.connection = null;
      throw error;
    });
  }
  try {
    cache.connection = await cache.promise;
    await upgradeIndexes(cache.connection);
    return cache.connection;
  } catch (error) {
    cache.promise = null;
    cache.connection = null;
    throw error;
  }
}
