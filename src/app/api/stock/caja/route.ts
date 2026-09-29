import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { StockTicket } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { StockError } from "@/lib/stock-service";
import { registerCounterOperation, type CounterInput } from "@/lib/stock-counter";
import { WAREHOUSE_KEYS } from "@/lib/warehouses";

/**
 * La caja del depósito: entradas y salidas de varios materiales de una vez,
 * escaneados con el lector o la cámara. GET trae los últimos comprobantes
 * (para reimprimir el ticket); POST confirma una operación. Las cuentas están
 * en src/lib/stock-counter.ts.
 */
const objectId = z.string().refine(isValidObjectId, "ID inválido");
const warehouse = z.enum(WAREHOUSE_KEYS);
const line = z.object({ itemId: objectId, quantity: z.coerce.number().positive("Cada cantidad tiene que ser mayor a cero"), unitCostCents: z.coerce.number().int().min(0).optional() });
const common = { note: z.string().trim().max(1000).optional().default(""), date: z.coerce.date().optional(), lines: z.array(line).min(1, "Escaneá al menos un material").max(200) };
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ingreso"), warehouse: warehouse.default("central"), supplierId: z.union([objectId, z.literal("")]).optional().transform(value => value || undefined), reference: z.string().trim().max(120).optional().default(""), ...common }),
  z.object({ kind: z.literal("egreso"), workId: objectId, warehouse: z.union([warehouse, z.literal("")]).optional().transform(value => value || undefined), ...common }),
]);

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "stock")) throw new Error("FORBIDDEN");
    await connectDB();
    const limit = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get("limit") || 15)));
    const items = await StockTicket.find().sort({ createdAt: -1 }).limit(limit).lean();
    return Response.json({ items });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const { ticket, changed } = await registerCounterOperation(parsed.data as CounterInput, session);
    const ip = request.headers.get("x-forwarded-for") || undefined;
    for (const entry of changed) await audit(session, `stock_${parsed.data.kind}`, "stock", entry.item._id, entry.before, entry.after, ip);
    return Response.json(ticket, { status: 201 });
  } catch (error) {
    if (error instanceof StockError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
