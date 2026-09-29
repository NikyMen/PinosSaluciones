import readXlsxFile from "read-excel-file/node";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { importPayroll, parsePayrollWorkbook, previewPayroll, type Sheet } from "@/lib/payroll-import";

export const runtime = "nodejs";

/**
 * Importar la planilla de la quincena. Con `mode=preview` cuenta qué va a pasar
 * sin guardar nada; con `mode=confirm` (y `sites`: a qué obra va cada una de la
 * planilla) la carga.
 */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "workers")) throw new Error("FORBIDDEN");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return Response.json({ error: "Elegí la planilla de la quincena" }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return Response.json({ error: "La planilla pesa más de 10 MB" }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".xlsx")) return Response.json({ error: "La planilla tiene que ser un Excel .xlsx" }, { status: 400 });

    let sheets: Sheet[];
    try { sheets = await readXlsxFile(Buffer.from(await file.arrayBuffer())) as unknown as Sheet[]; }
    catch { return Response.json({ error: "No se pudo leer el Excel. Probá abrirlo y guardarlo de nuevo como .xlsx." }, { status: 400 }); }
    const parsed = parsePayrollWorkbook(sheets);

    await connectDB();
    if (form.get("mode") !== "confirm") return Response.json(await previewPayroll(parsed));

    let sites: Record<string, string> = {};
    try { sites = JSON.parse(String(form.get("sites") || "{}")); } catch { return Response.json({ error: "Las obras elegidas no son válidas" }, { status: 400 }); }
    const summary = await importPayroll(parsed, sites, session);
    await audit(session, "payroll_import", "workers", null, null, { fileName: file.name, ...summary }, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(summary, { status: 201 });
  } catch (error) { return apiError(error); }
}
