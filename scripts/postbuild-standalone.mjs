// next build regenera .next/standalone pero no copia .next/static ni public/
// dentro. Sin eso el server standalone responde el HTML y devuelve 404 en todos
// los assets. Este postbuild los deja en su lugar despues de cada build.
import { cp, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");

try {
  await access(standalone);
} catch {
  console.log("[postbuild] no hay .next/standalone (output != standalone), nada que copiar");
  process.exit(0);
}

for (const [from, to] of [
  [path.join(root, ".next", "static"), path.join(standalone, ".next", "static")],
  [path.join(root, "public"), path.join(standalone, "public")],
]) {
  try {
    await access(from);
  } catch {
    console.log(`[postbuild] ${path.relative(root, from)} no existe, omitido`);
    continue;
  }
  await cp(from, to, { recursive: true, force: true });
  console.log(`[postbuild] ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}
