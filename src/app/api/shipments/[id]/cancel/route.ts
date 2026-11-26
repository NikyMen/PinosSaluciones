import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { Shipment } from "@/lib/models";
import { StockError } from "@/lib/stock-service";
import { cancelShipment } from "@/lib/shipments";

const schema = z.object({ reason: z.string().trim().min(3, "Contá por qué se anula").max(300) });

/** Anula un envío sin guía: el material vuelve al depósito de origen (el de una venta no movió stock: sólo se anula). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const before = await Shipment.findById(id).lean<{ salesRemitoId?: unknown }>();
    // El envío de una venta también lo maneja quien vende.
    if (!canWrite(session, "stock") && !(before?.salesRemitoId && canWrite(session, "invoices"))) throw new Error("FORBIDDEN");
    const after = await cancelShipment(id, parsed.data.reason, session);
    await audit(session, "update", "shipments", id, before, after, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(after);
  } catch (error) {
    if (error instanceof StockError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
