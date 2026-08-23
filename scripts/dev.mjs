// Entorno de desarrollo completo con una sola orden: MongoDB local + seed + web + worker.
// La base corre desde node_modules (mongodb-memory-server), no necesita instalar nada en el
// sistema y guarda los datos en .mongo-data/, así que sobreviven entre reinicios.
// Nunca toca la base del VPS.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { MongoMemoryServer } from "mongodb-memory-server";

const require = createRequire(import.meta.url);
const DB_NAME = "pinos_erp";
const DB_PORT = 27017;
const DB_PATH = ".mongo-data";

try { process.loadEnvFile(".env"); } catch { console.log("[dev] sin .env, uso los valores por defecto"); }

const children = [];
let mongo;
let shuttingDown = false;

function run(label, args, env) {
  const child = spawn(process.execPath, args, { stdio: ["ignore", "inherit", "inherit"], env });
  child.on("exit", code => { if (!shuttingDown && code) { console.error(`[dev] ${label} terminó con código ${code}`); void shutdown(code); } });
  children.push(child);
  return child;
}

function wait(child) {
  return new Promise((resolve, reject) => {
    child.once("exit", code => code ? reject(new Error(`código ${code}`)) : resolve());
    child.once("error", reject);
  });
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[dev] cerrando…");
  for (const child of children) if (!child.killed) child.kill();
  await mongo?.stop().catch(() => {});
  process.exit(code);
}

mkdirSync(DB_PATH, { recursive: true });

console.log("[dev] levantando MongoDB local…");
console.log("[dev] la primera vez descarga el binario de mongod (~100 MB), después arranca en segundos");
try {
  mongo = await MongoMemoryServer.create({
    instance: { port: DB_PORT, dbName: DB_NAME, dbPath: DB_PATH, storageEngine: "wiredTiger" },
  });
} catch (error) {
  console.error(`[dev] no se pudo iniciar MongoDB: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  console.error(`[dev] revisá que el puerto ${DB_PORT} esté libre`);
  process.exit(1);
}

const uri = `mongodb://127.0.0.1:${DB_PORT}/${DB_NAME}`;
const env = { ...process.env, MONGODB_URI: uri };
console.log(`[dev] MongoDB local en ${uri}`);

console.log("[dev] verificando usuario administrador…");
try {
  await wait(run("seed", [require.resolve("tsx/cli"), "scripts/seed.ts"], env));
} catch (error) {
  console.error(`[dev] el seed falló (${error.message}). Revisá ADMIN_EMAIL y ADMIN_PASSWORD en .env`);
  await shutdown(1);
}

run("worker", ["scripts/worker.mjs"], env);
run("next", [require.resolve("next/dist/bin/next"), "dev"], env);

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
