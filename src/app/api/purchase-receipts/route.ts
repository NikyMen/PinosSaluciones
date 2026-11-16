import { Types } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { Purchase, PurchaseReceipt, Supplier } from "@/lib/models";
import { sanitizeSearch } from "@/lib/schemas";
import { audit } from "@/lib/audit";
import { purchaseInvoiceReceipts, registerStandaloneReceipt, standaloneReceiptSchema } from "@/lib/purchase-receipts";

type Lean = Record<string, unknown> & { _id: Types.ObjectId };

/** Los remitos de compra cargados, el más nuevo primero, con su orden y su proveedor (?search=). */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const params = new URL(request.url).searchParams;
    if (params.has("supplierId")) {
      if (!canWrite(session, "expenses")) throw new Error("FORBIDDEN");
      await connectDB();
      return Response.json({ items: await purchaseInvoiceReceipts(params.get("supplierId") || "", params.get("purchaseId") || "", params.get("expenseId") || "") });
    }
    if (!canRead(session, "purchases")) throw new Error("FORBIDDEN");
    await connectDB();
    const search = sanitizeSearch(params.get("search") || "");
    const orders = search ? await Purchase.find({ number: { $regex: search, $options: "i" } }).select("_id").lean<Lean[]>() : [];
    const filter = search ? { $or: [{ number: { $regex: search, $options: "i" } }, { supplierRemito: { $regex: search, $options: "i" } }, { purchaseId: { $in: orders.map(order => order._id) } }] } : {};
    const receipts = await PurchaseReceipt.find(filter).sort({ date: -1, createdAt: -1 }).limit(300).lean<Lean[]>();
    const [purchases, suppliers] = await Promise.all([
      Purchase.find({ _id: { $in: receipts.map(receipt => receipt.purchaseId).filter(Boolean) } }).select("number status receptionStatus requestId").lean<Lean[]>(),
      Supplier.find({ _id: { $in: receipts.map(receipt => receipt.supplierId).filter(Boolean) } }).select("name").lean<Lean[]>(),
    ]);
    const purchaseById = new Map(purchases.map(purchase => [String(purchase._id), purchase]));
    const supplierName = new Map(suppliers.map(supplier => [String(supplier._id), String(supplier.name || "")]));
    return Response.json({ items: receipts.map(receipt => ({ ...receipt, order: purchaseById.get(String(receipt.purchaseId)) || null, supplierName: supplierName.get(String(receipt.supplierId)) || "" })) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "purchases") || !canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const parsed = standaloneReceiptSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const receipt = await registerStandaloneReceipt(parsed.data, session);
    await audit(session, "create", "purchase_receipts", receipt._id, null, receipt.toObject(), request.headers.get("x-forwarded-for") || undefined);
    return Response.json(receipt, { status: 201 });
  } catch (error) { return apiError(error); }
}
