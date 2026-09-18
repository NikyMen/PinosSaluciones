import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canViewSection } from "@/lib/permissions";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { cancelBooking } from "@/lib/google-calendar";

export const runtime = "nodejs";

/** Cancela un turno (no lo borra: queda en el historial con status "cancelado"). */
export async function PATCH(request: Request, context: RouteContext<"/api/calendar/bookings/[id]">) {
  try {
    const session = await requireSession();
    if (!canViewSection(session, "calendario")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

    const booking = await cancelBooking(id);
    await audit(session, "cancel", "calendario", id, null, booking, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(booking);
  } catch (error) {
    return apiError(error);
  }
}
