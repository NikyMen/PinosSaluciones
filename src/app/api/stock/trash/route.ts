import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { StockTrash } from "@/lib/models";
import { apiError } from "@/lib/api";

/** Los materiales borrados del stock, el último primero. */
export async function GET() {
  try {
    const session = await requireSession();
    if (!canRead(session, "stock")) throw new Error("FORBIDDEN");
    await connectDB();
    const rows = await StockTrash.find().sort({ deletedAt: -1 }).limit(200).lean();
    return Response.json({ items: rows.map(row => ({ _id: String(row._id), name: row.name, category: row.item?.category || "", quantity: Number(row.item?.quantity || 0), deletedAt: row.deletedAt, deletedByName: row.deletedByName || "" })) });
  } catch (error) { return apiError(error); }
}
