// Arranque de pinos-web (PM2).
//
// El server standalone de Next hace `process.chdir(__dirname)` y carga el .env
// de .next/standalone/, no el de la raiz del proyecto. Este wrapper carga primero
// el .env de la carpeta principal: @next/env no pisa variables que ya existen en
// process.env, asi que la raiz gana y queda como unica fuente de verdad.
//
// Ademas sincroniza el usuario admin con ADMIN_EMAIL/ADMIN_PASSWORD en cada
// arranque, para poder recuperar el acceso editando el .env y reiniciando PM2.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.loadEnvFile(path.join(projectRoot, ".env"));
  console.log(`[start-web] .env cargado desde ${projectRoot}`);
} catch (error) {
  console.warn(`[start-web] no se pudo leer ${path.join(projectRoot, ".env")}: ${error.message}`);
}

// El sync no debe impedir que el sitio levante: si Mongo esta caido, se loguea y sigue.
try {
  const { syncAdmin } = await import("./sync-admin.mjs");
  await syncAdmin();
} catch (error) {
  console.error(`[start-web] admin-sync fallo, el server arranca igual: ${error.message}`);
}

// server.js es CommonJS y hace chdir a su propio directorio.
createRequire(import.meta.url)(path.join(projectRoot, ".next", "standalone", "server.js"));
