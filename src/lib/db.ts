import mongoose from "mongoose";

type Cache = { connection: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalMongo = globalThis as typeof globalThis & { mongooseCache?: Cache };
const cache = globalMongo.mongooseCache ?? { connection: null, promise: null };
globalMongo.mongooseCache = cache;

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
    return cache.connection;
  } catch (error) {
    cache.promise = null;
    cache.connection = null;
    throw error;
  }
}
