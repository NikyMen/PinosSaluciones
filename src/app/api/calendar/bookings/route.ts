import { z } from "zod";
import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canViewSection } from "@/lib/permissions";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createBooking, listBookings } from "@/lib/google-calendar";

export const runtime = "nodejs";

const schema = z.object({
  clientId: z.string().refine(isValidObjectId, "Cliente inválido").optional(),
  contactName: z.string().trim().min(1, "El nombre es requerido.").max(120),
  contactPhone: z.string().trim().max(50).optional(),
  contactEmail: z.string().trim().email("Email inválido.").optional().or(z.literal("")),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)."),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora inválido (HH:mm)."),
  notes: z.string().trim().max(1_000).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    if (!canViewSection(session, "calendario")) throw new Error("FORBIDDEN");
    return Response.json({ items: await listBookings() });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canViewSection(session, "calendario")) throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });

    const booking = await createBooking({
      clientId: parsed.data.clientId,
      contactName: parsed.data.contactName,
      contactPhone: parsed.data.contactPhone,
      contactEmail: parsed.data.contactEmail || undefined,
      date: parsed.data.date,
      time: parsed.data.time,
      notes: parsed.data.notes,
      createdBy: { id: session.userId, name: session.name },
    });

    await audit(session, "create", "calendario", booking._id, null, booking, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(booking, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
