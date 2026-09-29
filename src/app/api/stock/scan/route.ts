import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { StockItem } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { StockError } from "@/lib/stock-service";
import { ensureBarcode, findByCode } from "@/lib/stock-counter";
import { withLastPrices } from "@/lib/stock-prices";
import { cleanScannedCode } from "@/lib/barcode";

/**
 * Lo que leyó el lector de códigos o la cámara.
 * GET ?code= busca el material (por código de barras o código interno).
 * POST le asigna a un material el código leído, o le genera uno propio
 * (PS-000123) para imprimirle la etiqueta.
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "stock")) throw new Error("FORBIDDEN");
    const code = cleanScannedCode(new URL(request.url).searchParams.get("code") || "");
    if (!code) return Response.json({ error: "Falta el código" }, { status: 400 });
    await connectDB();
    const item = await findByCode(code);
    if (!item) return Response.json({ error: `El código ${code} no está cargado en ningún material`, code }, { status: 404 });
    const [withPrice] = await withLastPrices([item as Record<string, unknown>]);
    return Response.json({ item: withPrice });
  } catch (error) { return apiError(error); }
}

const schema = z.object({
  itemId: z.string().refine(isValidObjectId, "ID inválido"),
  code: z.string().optional().transform(value => cleanScannedCode(value || "")),
  generate: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    const { itemId, code, generate } = parsed.data;
    if (!code && !generate) return Response.json({ error: "Falta el código" }, { status: 400 });
    await connectDB();
    const before = await StockItem.findById(itemId, { movements: 0 }).lean() as { barcode?: string; name?: string } | null;
    if (!before) return Response.json({ error: "Material no encontrado" }, { status: 404 });
    if (generate) {
      const barcode = await ensureBarcode(itemId);
      if (barcode !== before.barcode) await audit(session, "stock_barcode", "stock", itemId, before, { ...before, barcode });
      return Response.json({ barcode });
    }
    // Un código es de un solo material: si ya lo tiene otro, se avisa cuál.
    const owner = await StockItem.findOne({ barcode: code, _id: { $ne: itemId } }).select("name").lean() as { name?: string } | null;
    if (owner) return Response.json({ error: `El código ${code} ya es de "${owner.name}"` }, { status: 409 });
    await StockItem.updateOne({ _id: itemId }, { $set: { barcode: code } });
    await audit(session, "stock_barcode", "stock", itemId, before, { ...before, barcode: code });
    return Response.json({ barcode: code });
  } catch (error) {
    if (error instanceof StockError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
