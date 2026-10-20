import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { heicToJpeg, isHeif } from "../src/lib/heic";

// Pasa a JPEG las fotos HEIC del iPhone que se subieron con extensión de imagen
// (.jpg, .png, .webp) antes de que la subida las convirtiera: el navegador las
// mostraba rotas. Se convierten en el lugar, con el mismo nombre, así no hay que
// tocar la base; la ruta /api/uploads las sirve con su tipo real. El original
// queda en heic-originales/, al lado de la carpeta de uploads.
// pnpm migrate:heic [--apply]
const apply = process.argv.includes("--apply");
const directory = process.env.UPLOAD_DIR || path.join(process.cwd(), ".uploads");
const backup = path.join(path.dirname(directory), "heic-originales");

async function main() {
  const candidates = (await readdir(directory)).filter(name => /\.(jpe?g|png|webp|gif)$/i.test(name));
  const found: string[] = [];
  for (const name of candidates) {
    const content = await readFile(path.join(directory, name));
    if (isHeif(content)) found.push(name);
  }

  console.log(`[heic] ${candidates.length} imágenes revisadas en ${directory}, ${found.length} son HEIC`);
  if (!apply) {
    for (const name of found) console.log(`[heic] convertiría ${name}`);
    if (found.length) console.log("[heic] repetir con --apply para convertirlas");
  } else {
    await mkdir(backup, { recursive: true });
    for (const name of found) {
      const source = path.join(directory, name);
      await copyFile(source, path.join(backup, name));
      const jpeg = await heicToJpeg(await readFile(source));
      await writeFile(source, jpeg);
      console.log(`[heic] ${name} convertida (${jpeg.length} bytes), original en ${backup}`);
    }
  }
}

main().catch(error => { console.error(error); process.exit(1); });
