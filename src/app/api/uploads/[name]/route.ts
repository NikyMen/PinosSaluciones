import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { UPLOAD_TYPES } from "@/lib/upload-types";

const validName = new RegExp(`^[a-f\\d-]+(${Object.keys(UPLOAD_TYPES).map(extension => `\\${extension}`).join("|")})$`, "i");

/**
 * Sirve un archivo subido. Los PDF y las fotos se abren en el navegador; el
 * resto se descarga. Con `?download=nombre.pdf` se baja siempre, con ese nombre.
 */
export async function GET(request: Request, context: RouteContext<"/api/uploads/[name]">) {
  try {
    await requireSession();
    const { name } = await context.params;
    if (name !== path.basename(name) || !validName.test(name)) return Response.json({ error: "Archivo inválido" }, { status: 400 });
    const directory = process.env.UPLOAD_DIR || path.join(process.cwd(), ".uploads");
    const file = await readFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ directory, name));
    const type = UPLOAD_TYPES[path.extname(name).toLowerCase()];
    const download = new URL(request.url).searchParams.get("download");
    const filename = (download || name).replace(/[\r\n"]/g, "").slice(0, 150);
    const disposition = download || !type?.inline ? "attachment" : "inline";
    return new Response(file, {
      headers: {
        "content-type": type?.mime || "application/octet-stream",
        "content-disposition": `${disposition}; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return Response.json({ error: "No encontrado" }, { status: 404 });
    return apiError(error);
  }
}
