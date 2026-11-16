import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { HolidayCalendar } from "@/lib/models";
import { apiError, HttpError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { workCalendars } from "@/lib/work-calendar";

const schema = z.object({
  year: z.number().int().min(2000).max(2100),
  holidays: z.array(z.object({ date: z.iso.date(), name: z.string().trim().min(1).max(100) })).max(366),
}).refine(input => input.holidays.every(row => row.date.startsWith(String(input.year) + "-"))
  && new Set(input.holidays.map(row => row.date)).size === input.holidays.length, "Usá fechas del año elegido, una vez por día");

export async function GET() {
  try {
    const session = await requireSession();
    if (!canRead(session, "works") && !canWrite(session, "works") && session.role !== "gerencia") throw new Error("FORBIDDEN");
    await connectDB();
    return Response.json({ items: await workCalendars() });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || "Revisá los feriados");
    await connectDB();
    const input = parsed.data;
    const filter = { year: input.year };
    const before = await HolidayCalendar.findOne(filter).lean();
    const after = await HolidayCalendar.findOneAndUpdate(filter, { $set: input }, { upsert: true, returnDocument: "after" }).lean();
    await audit(session, "update", "holiday_calendars", input.year, before, after);
    return Response.json(after);
  } catch (error) { return apiError(error); }
}
