import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { extensionOf, MAX_UPLOAD_BYTES, UPLOAD_TYPES } from "@/lib/upload-types";

/** Sube un archivo y devuelve dónde quedó, con su nombre original para mostrarlo. */
export async function POST(request: Request) {
  try {
    await requireSession();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "Archivo inválido o mayor a 10 MB" }, { status: 400 });
    const extension = extensionOf(file.name);
    if (!UPLOAD_TYPES[extension]) return Response.json({ error: `No se aceptan archivos ${extension || "sin extensión"}. Se pueden subir PDF, fotos, Word, Excel, planos DWG, ZIP y texto.` }, { status: 400 });
    const directory = process.env.UPLOAD_DIR || path.join(process.cwd(), ".uploads");
    await mkdir(/* turbopackIgnore: true */ directory, { recursive: true });
    const name = randomUUID() + (extension === ".jpeg" ? ".jpg" : extension);
    const destination = path.join(/* turbopackIgnore: true */ directory, name);
    await writeFile(/* turbopackIgnore: true */ destination, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    return Response.json({ path: `/api/uploads/${name}`, name: file.name, size: file.size }, { status: 201 });
  } catch (error) { return apiError(error); }
}
