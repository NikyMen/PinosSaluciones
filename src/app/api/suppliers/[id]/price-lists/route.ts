import { isValidObjectId } from "mongoose";
import readXlsxFile from "read-excel-file/node";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Supplier } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { saveUpload } from "@/lib/uploads";
import { analyzeWorkbook, sheetPreviews, type PriceLayout, type WorkbookSheet } from "@/lib/price-lists";
import { assertNewest, currentList, PriceListConflict, previewImport, saveImport, supplierPrices } from "@/lib/price-list-service";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;
const column = z.coerce.number().int().min(0).max(200).optional();
// Las columnas que la persona marcó a mano cuando el Excel no se reconoció solo.
const layoutSchema = z.object({
  sheet: z.string().min(1), headerRow: z.coerce.number().int().min(0),
  columns: z.object({ code: column, name: column, description: column, presentation: column, minSale: column, price: column, kind: column }),
});

export async function GET(_request: Request, context: RouteContext<"/api/suppliers/[id]/price-lists">) {
  try {
    const session = await requireSession();
    if (!canRead(session, "suppliers")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const result = await supplierPrices(id);
    if (!result) return Response.json({ error: "Proveedor no encontrado" }, { status: 404 });
    return Response.json(result);
  } catch (error) { return apiError(error); }
}

/**
 * Subir una lista. Va en dos pasos con el mismo archivo: `mode=preview` lee el
 * Excel y cuenta qué cambiaría sin guardar nada; `mode=confirm` la guarda y la
 * deja como vigente. Si no se reconocen las columnas, contesta `needsMapping`
 * con las primeras filas de cada hoja para que se marquen a mano.
 */
export async function POST(request: Request, context: RouteContext<"/api/suppliers/[id]/price-lists">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "suppliers")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return Response.json({ error: "Elegí el Excel de la lista" }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "El archivo pesa más de 10 MB" }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".xlsx")) return Response.json({ error: "La lista tiene que ser un Excel .xlsx. Si viene como .xls, abrilo en Excel y guardalo como .xlsx." }, { status: 400 });

    let manual: PriceLayout | null = null;
    const layoutText = String(form.get("layout") || "");
    if (layoutText) {
      const parsed = layoutSchema.safeParse(JSON.parse(layoutText));
      if (!parsed.success) return Response.json({ error: "Las columnas marcadas no son válidas" }, { status: 400 });
      manual = parsed.data;
    }

    const content = Buffer.from(await file.arrayBuffer());
    let sheets: WorkbookSheet[];
    try { sheets = await readXlsxFile(content) as unknown as WorkbookSheet[]; }
    catch { return Response.json({ error: "No se pudo leer el Excel. Probá abrirlo y guardarlo de nuevo como .xlsx." }, { status: 400 }); }

    await connectDB();
    const supplier = await Supplier.findById(id).select("name priceFormat").lean() as { name: string; priceFormat?: PriceLayout } | null;
    if (!supplier) return Response.json({ error: "Proveedor no encontrado" }, { status: 404 });

    const analysis = analyzeWorkbook(sheets, { fileName: file.name, manual, saved: supplier.priceFormat || null });
    const previews = sheetPreviews(sheets);
    if (!analysis.ok) return Response.json({ needsMapping: true, sheets: previews });

    const vat = String(form.get("pricesIncludeVat") || "");
    const pricesIncludeVat = vat === "true" ? true : vat === "false" ? false : analysis.pricesIncludeVat ?? false;
    const validFromText = String(form.get("validFrom") || analysis.validFrom || "");
    const { items, skipped, legend } = analysis.parsed;

    if (form.get("mode") !== "confirm") {
      const [preview, current] = await Promise.all([previewImport(id, items, pricesIncludeVat), currentList(id)]);
      return Response.json({
        needsMapping: false, sheets: previews, layout: analysis.layout, source: analysis.source,
        validFrom: validFromText, detectedVat: analysis.pricesIncludeVat, pricesIncludeVat,
        itemCount: items.length, skipped: skipped.slice(0, 10), skippedCount: skipped.length, legend,
        current: current ? { validFrom: current.validFrom, itemCount: current.itemCount } : null,
        ...preview,
      });
    }

    const validFrom = /^\d{4}-\d{2}-\d{2}$/.test(validFromText) ? new Date(`${validFromText}T00:00:00.000Z`) : null;
    if (!validFrom || Number.isNaN(validFrom.getTime())) return Response.json({ error: "Poné desde qué fecha vale la lista" }, { status: 400 });
    // Antes de guardar el archivo: una lista vieja no llega ni a ocupar lugar.
    await assertNewest(id, validFrom);

    const stored = await saveUpload(content, ".xlsx");
    const result = await saveImport({
      supplierId: id, items, layout: analysis.layout, legend, validFrom, pricesIncludeVat,
      fileName: file.name, file: stored, session, rememberLayout: analysis.source === "manual",
    });
    await audit(session, "price_list_import", "suppliers", id, null, {
      priceListId: result.list._id, fileName: file.name, validFrom, itemCount: items.length, summary: result.summary,
    }, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof PriceListConflict) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof SyntaxError) return Response.json({ error: "Las columnas marcadas no son válidas" }, { status: 400 });
    return apiError(error);
  }
}
