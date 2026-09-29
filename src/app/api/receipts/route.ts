import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { pendingInvoices, receiptPdfData, ReceiptError, receiptSchema, saveReceipt } from "@/lib/receipt-service";

/** Las facturas del cliente con saldo, para armar el recibo (?clientId=, y ?receipt= al editar uno). */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "collections")) throw new Error("FORBIDDEN");
    const params = new URL(request.url).searchParams;
    const clientId = params.get("clientId") || "";
    const receipt = params.get("receipt") || undefined;
    if (!isValidObjectId(clientId) || (receipt && !isValidObjectId(receipt))) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    return Response.json({ items: await pendingInvoices(clientId, receipt) });
  } catch (error) { return apiError(error); }
}

/** Nuevo recibo: número correlativo, se aplica a las facturas y devuelve los datos del PDF. */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "collections")) throw new Error("FORBIDDEN");
    const parsed = receiptSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Recibo inválido" }, { status: 400 });
    await connectDB();
    const receipt = await saveReceipt(parsed.data, session);
    await audit(session, "create", "collections", receipt._id, null, receipt, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ receipt, pdf: await receiptPdfData(String(receipt._id)) }, { status: 201 });
  } catch (error) {
    if (error instanceof ReceiptError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
