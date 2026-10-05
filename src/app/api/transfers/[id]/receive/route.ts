import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { StockTransfer } from "@/lib/models";
import { StockError } from "@/lib/stock-service";
import { receiveTransfer } from "@/lib/stock-transfers";

const objectId = z.string().refine(isValidObjectId, "ID inválido");
const schema = z.object({
  note: z.string().trim().max(1000).optional().default(""),
  // Sin renglones: llegó todo bien.
  lines: z.array(z.object({ itemId: objectId, receivedQty: z.coerce.number().min(0), damagedQty: z.coerce.number().min(0).optional().default(0), note: z.string().trim().max(300).optional().default("") })).max(200).optional(),
});

/** El depósito de destino confirma lo que llegó; lo que faltó o llegó dañado queda documentado. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const before = await StockTransfer.findById(id).lean();
    const { transfer, changed } = await receiveTransfer(id, parsed.data, session);
    const ip = request.headers.get("x-forwarded-for") || undefined;
    await audit(session, "update", "stock_transfers", id, before, transfer, ip);
    for (const entry of changed) await audit(session, "stock_recepcion", "stock", entry.item._id, entry.before, entry.after, ip);
    return Response.json(transfer);
  } catch (error) {
    if (error instanceof StockError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
