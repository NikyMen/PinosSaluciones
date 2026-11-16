import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { Shipment } from "@/lib/models";
import { StockError } from "@/lib/stock-service";
import { setShipmentTracking } from "@/lib/shipments";

const schema = z.object({
  trackingNumber: z.string().trim().min(1, "Poné el N° de guía o de remito del transporte").max(120),
  files: z.array(z.object({ path: z.string().startsWith("/api/uploads/"), name: z.string().max(300).optional() })).max(10).optional().default([]),
});

/** Carga el N° de guía (o el remito del transporte) después de despachar. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const before = await Shipment.findById(id).lean();
    const after = await setShipmentTracking(id, parsed.data, session);
    await audit(session, "update", "shipments", id, before, after, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(after);
  } catch (error) {
    if (error instanceof StockError) return Response.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
