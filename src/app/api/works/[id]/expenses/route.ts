import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Expense, Work } from "@/lib/models";
import { apiError } from "@/lib/api";
import { signedAmount } from "@/lib/invoice-labels";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canRead(session, "works")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

    await connectDB();
    const work = await Work.exists({ _id: id });
    if (!work) return Response.json({ error: "Obra no encontrada" }, { status: 404 });

    const items = await Expense.find({ workId: id, status: { $ne: "anulado" } })
      .sort({ issueDate: -1, createdAt: -1 })
      .lean();
    // La nota de crédito del proveedor resta.
    const totalCents = items.reduce((total, item) => total + signedAmount(item as Record<string, unknown>), 0);
    return Response.json({ items, totalCents });
  } catch (error) {
    return apiError(error);
  }
}
