import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { StockTransfer } from "@/lib/models";
import { StockError } from "@/lib/stock-service";
import { sendTransfer } from "@/lib/stock-transfers";
import { WAREHOUSE_KEYS } from "@/lib/warehouses";

const objectId = z.string().refine(isValidObjectId, "ID inválido");
const schema = z.object({
  from: z.enum(WAREHOUSE_KEYS), to: z.enum(WAREHOUSE_KEYS),
  note: z.string().trim().max(1000).optional().default(""),
  lines: z.array(z.object({ itemId: objectId, quantity: z.coerce.number().positive("Cada cantidad tiene que ser mayor a cero") })).min(1, "Agregá al menos un material").max(200),
});

/** Las transferencias, las que siguen en tránsito primero (?status=en_transito para solo esas). */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "stock")) throw new Error("FORBIDDEN");
    await connectDB();
    const status = new URL(request.url).searchParams.get("status") || "";
    const items = await StockTransfer.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200).lean<Array<{ status?: string }>>();
    items.sort((a, b) => Number(b.status === "en_transito") - Number(a.status === "en_transito"));
    return Response.json({ items });
  } catch (error) { return apiError(error); }
}

/** Manda varios materiales de un depósito al otro: quedan en tránsito hasta que se reciben. */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const { transfer, changed } = await sendTransfer(parsed.data, session);
    const ip = request.headers.get("x-forwarded-for") || undefined;
    await audit(session, "create", "stock_transfers", transfer._id, null, transfer, ip);
    for (const entry of changed) await audit(session, "stock_transferencia", "stock", entry.item._id, entry.before, entry.after, ip);
    return Response.json(transfer, { status: 201 });
  } catch (error) {
    if (error instanceof StockError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
