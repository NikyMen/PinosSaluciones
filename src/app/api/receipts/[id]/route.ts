import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Collection } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { receiptPdfData, ReceiptError, receiptSchema, saveReceipt } from "@/lib/receipt-service";

/** Los datos del PDF del recibo. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canRead(session, "collections")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const pdf = await receiptPdfData(id);
    if (!pdf) return Response.json({ error: "Recibo no encontrado" }, { status: 404 });
    return Response.json(pdf);
  } catch (error) { return apiError(error); }
}

/** Cambia un recibo: deshace lo que había aplicado a cada factura y aplica lo nuevo. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "collections")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = receiptSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Recibo inválido" }, { status: 400 });
    await connectDB();
    const before = await Collection.findById(id).lean();
    const receipt = await saveReceipt(parsed.data, session, id);
    await audit(session, "update", "collections", id, before, receipt, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ receipt, pdf: await receiptPdfData(id) });
  } catch (error) {
    if (error instanceof ReceiptError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
