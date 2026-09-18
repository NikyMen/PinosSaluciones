import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getCalendarSettings, saveCalendarSettings } from "@/lib/google-calendar";

export const runtime = "nodejs";

const schema = z.object({
  calendarId: z.string().trim().min(1).max(200).optional(),
  meetingDurationMinutes: z.coerce.number().int().min(10).max(240).optional(),
  slotIntervalMinutes: z.coerce.number().int().min(5).max(120).optional(),
  bufferBetweenMeetings: z.coerce.number().int().min(0).max(120).optional(),
  workingDays: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7).optional(),
  workingHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  workingHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  createMeetLink: z.boolean().optional(),
  defaultTitle: z.string().trim().min(1).max(200).optional(),
  defaultDescription: z.string().trim().max(2_000).optional(),
});

/** Devuelve la config sin exponer los tokens crudos: solo si hay una cuenta conectada. */
function toPublic(settings: Awaited<ReturnType<typeof getCalendarSettings>>) {
  const { refreshToken, accessToken, tokenExpiry: _tokenExpiry, ...rest } = settings;
  return { ...rest, connected: !!refreshToken, tokenValid: !!accessToken };
}

export async function GET() {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    return Response.json(toPublic(await getCalendarSettings()));
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });

    const before = await getCalendarSettings();
    const updated = await saveCalendarSettings(parsed.data);
    await audit(session, "update", "calendario", "main", before, updated, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(toPublic(updated));
  } catch (error) {
    return apiError(error);
  }
}
