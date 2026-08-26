// Sincroniza el usuario administrador con ADMIN_EMAIL / ADMIN_PASSWORD del .env.
// Se ejecuta en cada arranque de pinos-web (ver scripts/start-web.mjs), asi que
// cambiar esas variables y reiniciar PM2 alcanza para recuperar el acceso.
// Solo toca al usuario de ADMIN_EMAIL: el resto de las cuentas no se modifican.
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";

export async function syncAdmin({ log = console.log } = {}) {
  const uri = process.env.MONGODB_URI?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!uri) return log("[admin-sync] sin MONGODB_URI, omitido");
  if (!email || !password) return log("[admin-sync] sin ADMIN_EMAIL/ADMIN_PASSWORD, omitido");
  if (password.length < 8) return log("[admin-sync] ADMIN_PASSWORD tiene menos de 8 caracteres, omitido");

  const connection = await mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: Math.max(1000, Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 5000)),
    maxPoolSize: 1,
  }).asPromise();

  try {
    const users = connection.collection("users");
    const existing = await users.findOne({ email });

    if (!existing) {
      await users.insertOne({
        name: "Administrador",
        email,
        passwordHash: await bcrypt.hash(password, 12),
        role: "gerencia",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return log(`[admin-sync] usuario ${email} creado en ${connection.name}`);
    }

    // Solo reescribimos el hash si la clave del .env dejo de coincidir.
    const matches = typeof existing.passwordHash === "string" && await bcrypt.compare(password, existing.passwordHash);
    if (matches && existing.active === true) return log(`[admin-sync] ${email} ya esta al dia`);

    await users.updateOne(
      { _id: existing._id },
      { $set: { passwordHash: matches ? existing.passwordHash : await bcrypt.hash(password, 12), active: true, updatedAt: new Date() } },
    );
    log(`[admin-sync] ${email} actualizado en ${connection.name}${matches ? " (reactivado)" : " (contrasena del .env aplicada)"}`);
  } finally {
    await connection.close();
  }
}

// Ejecutado directamente: `node --env-file-if-exists=.env scripts/sync-admin.mjs`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncAdmin().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
}
