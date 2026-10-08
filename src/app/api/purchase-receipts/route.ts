import { Types } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { Purchase, PurchaseReceipt, Supplier } from "@/lib/models";
import { sanitizeSearch } from "@/lib/schemas";

type Lean = Record<string, unknown> & { _id: Types.ObjectId };

/** Los remitos de compra cargados, el más nuevo primero, con su orden y su proveedor (?search=). */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "purchases")) throw new Error("FORBIDDEN");
    await connectDB();
    const search = sanitizeSearch(new URL(request.url).searchParams.get("search") || "");
    const orders = search ? await Purchase.find({ number: { $regex: search, $options: "i" } }).select("_id").lean<Lean[]>() : [];
    const filter = search ? { $or: [{ number: { $regex: search, $options: "i" } }, { supplierRemito: { $regex: search, $options: "i" } }, { purchaseId: { $in: orders.map(order => order._id) } }] } : {};
    const receipts = await PurchaseReceipt.find(filter).sort({ date: -1, createdAt: -1 }).limit(300).lean<Lean[]>();
    const [purchases, suppliers] = await Promise.all([
      Purchase.find({ _id: { $in: receipts.map(receipt => receipt.purchaseId) } }).select("number status receptionStatus requestId").lean<Lean[]>(),
      Supplier.find({ _id: { $in: receipts.map(receipt => receipt.supplierId).filter(Boolean) } }).select("name").lean<Lean[]>(),
    ]);
    const purchaseById = new Map(purchases.map(purchase => [String(purchase._id), purchase]));
    const supplierName = new Map(suppliers.map(supplier => [String(supplier._id), String(supplier.name || "")]));
    return Response.json({ items: receipts.map(receipt => ({ ...receipt, order: purchaseById.get(String(receipt.purchaseId)) || null, supplierName: supplierName.get(String(receipt.supplierId)) || "" })) });
  } catch (error) { return apiError(error); }
}
