import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Guarda un archivo que generó o recibió el servidor, en la misma carpeta que /api/uploads. */
export async function saveUpload(content: Buffer, extension: ".pdf" | ".xlsx") {
  const directory = process.env.UPLOAD_DIR || path.join(process.cwd(), ".uploads");
  await mkdir(/* turbopackIgnore: true */ directory, { recursive: true });
  const name = randomUUID() + extension;
  await writeFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ directory, name), content, { flag: "wx" });
  return `/api/uploads/${name}`;
}
