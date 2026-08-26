import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB } from "../src/lib/db";
import { User } from "../src/lib/models";

function arg(name: string) {
  const hit = process.argv.find(value => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function list() {
  const users = await User.find({}).select("name email role active").lean();
  console.log(`Base: ${mongoose.connection.name} @ ${mongoose.connection.host}`);
  console.log(`Usuarios (${users.length}):`);
  for (const user of users as { name: string; email: string; role: string; active: boolean }[]) {
    console.log(`  ${user.email}  rol=${user.role}  activo=${user.active}`);
  }
  console.log("\nPara resetear una contraseña:");
  console.log("  pnpm user:password --email=alguien@dominio --password=NuevaClave123!");
  console.log("Para resetear el admin usando ADMIN_EMAIL/ADMIN_PASSWORD del .env:");
  console.log("  pnpm user:password --reset-admin");
}

async function main() {
  await connectDB();

  // Por defecto solo lista: nunca escribe sin una intención explícita.
  const explicitEmail = arg("email");
  const resetAdmin = has("reset-admin");
  if (!explicitEmail && !resetAdmin) {
    await list();
    process.exit(0);
  }

  const email = (explicitEmail || process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const password = arg("password") || (resetAdmin ? process.env.ADMIN_PASSWORD : undefined);
  if (!email) throw new Error("Falta --email=... (o ADMIN_EMAIL en el .env para --reset-admin)");
  if (!password || password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres");

  const user = await User.findOne({ email });
  if (!user) throw new Error(`No existe el usuario ${email} en la base ${mongoose.connection.name}`);

  user.passwordHash = await bcrypt.hash(password, 12);
  user.active = true;
  await user.save();
  console.log(`Contraseña actualizada para ${email} (activo=true) en ${mongoose.connection.name}`);
  process.exit(0);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
