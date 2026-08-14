import mongoose from "mongoose";

const uri = process.env.MONGODB_URI?.trim();
const timeout = Math.max(1000, Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 5000));

if (!uri) {
  console.error("Falta configurar MONGODB_URI en .env o en las variables del proceso.");
  process.exit(1);
}
const configuredUri = uri;

async function main() {
  try {
    const db = await mongoose.connect(configuredUri, {
      serverSelectionTimeoutMS: timeout,
      maxPoolSize: 1,
    });
    console.log(`MongoDB conectado: ${db.connection.host}/${db.connection.name}`);
    await mongoose.disconnect();
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "error desconocido";
    console.error(`No se pudo conectar a MongoDB: ${message}`);
    process.exit(1);
  }
}

void main();
