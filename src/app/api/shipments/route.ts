import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { Shipment, Work } from "@/lib/models";
import { StockError } from "@/lib/stock-service";
import { sendShipment } from "@/lib/shipments";
import { WAREHOUSE_KEYS } from "@/lib/warehouses";

const objectId = z.string().refine(isValidObjectId, "ID inválido");
const count = z.coerce.number().int().min(0).max(100000).optional();
const schema = z.object({
  company: z.enum(["tvp", "constructora"]).default("tvp"),
  from: z.enum(WAREHOUSE_KEYS),
  destination: z.string().trim().min(2, "Poné a dónde va").max(300),
  receiver: z.string().trim().max(200).optional().default(""),
  carrier: z.string().trim().min(2, "Poné el transporte").max(120),
  packages: count, pallets: count,
  workId: objectId.optional().or(z.literal("")).transform(value => value || undefined),
  note: z.string().trim().max(1000).optional().default(""),
  lines: z.array(z.object({
    itemId: objectId,
    quantity: z.coerce.number().positive("Cada cantidad tiene que ser mayor a cero"),
    declaredUnitCents: z.coerce.number().int().min(0).optional(),
  })).min(1, "Agregá al menos un material").max(200),
});

/** Los envíos, los más nuevos primero, con los transportes y destinos usados (para sugerirlos). */
export async function GET() {
  try {
    const session = await requireSession();
    if (!canRead(session, "stock")) throw new Error("FORBIDDEN");
    await connectDB();
    const items = await Shipment.find().sort({ createdAt: -1 }).limit(300).lean<Array<{ workId?: unknown }>>();
    const workIds = [...new Set(items.map(item => String(item.workId || "")).filter(Boolean))];
    const works = await Work.find({ _id: { $in: workIds } }).select("code name").lean<Array<{ _id: unknown; code?: string; name?: string }>>();
    const workLabels = Object.fromEntries(works.map(work => [String(work._id), [work.code, work.name].filter(Boolean).join(" · ")]));
    const [carriers, destinations] = await Promise.all([Shipment.distinct("carrier"), Shipment.distinct("destination")]);
    return Response.json({ items, workLabels, carriers, destinations });
  } catch (error) { return apiError(error); }
}

/** Despacha un envío por transporte: baja el stock y deja el remito con el valor declarado. */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const { shipment, changed } = await sendShipment(parsed.data, session);
    const ip = request.headers.get("x-forwarded-for") || undefined;
    await audit(session, "create", "shipments", shipment._id, null, shipment, ip);
    for (const entry of changed) await audit(session, "stock_envio", "stock", entry.item._id, entry.before, entry.after, ip);
    return Response.json(shipment, { status: 201 });
  } catch (error) {
    if (error instanceof StockError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
