import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canViewSection } from "@/lib/permissions";
import { apiError } from "@/lib/api";
import { getAvailableSlots } from "@/lib/google-calendar";

export const runtime = "nodejs";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (debe ser YYYY-MM-DD)."),
  duration: z.coerce.number().int().min(10).max(240).optional(),
});

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canViewSection(session, "calendario")) throw new Error("FORBIDDEN");

    const { searchParams } = new URL(request.url);
    const parsed = schema.safeParse({ date: searchParams.get("date"), duration: searchParams.get("duration") || undefined });
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });

    return Response.json(await getAvailableSlots({ date: parsed.data.date, durationMinutes: parsed.data.duration }));
  } catch (error) {
    return apiError(error);
  }
}
