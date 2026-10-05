import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { quoteAvailability } from "@/lib/reservations";

/** El stock de los materiales de la cotización: físico, reservado, en tránsito, disponible y faltante. Mirar no reserva nada. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canRead(session, "quotes")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    return Response.json({ items: await quoteAvailability(id) });
  } catch (error) { return apiError(error); }
}
