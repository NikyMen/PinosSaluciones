import { requireSession } from "@/lib/auth";
import { canViewSection } from "@/lib/permissions";
import { apiError } from "@/lib/api";
import { listCalendarEvents } from "@/lib/google-calendar";

export const runtime = "nodejs";

const day = /^\d{4}-\d{2}-\d{2}$/;

/** Los eventos del calendario entre dos fechas (el mes que se está mirando, con los días de los bordes). */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canViewSection(session, "calendario")) throw new Error("FORBIDDEN");
    const params = new URL(request.url).searchParams;
    const from = params.get("from") || "";
    const to = params.get("to") || "";
    if (!day.test(from) || !day.test(to)) return Response.json({ error: "Rango de fechas inválido" }, { status: 400 });
    const start = new Date(`${from}T00:00:00-03:00`);
    const end = new Date(`${to}T23:59:59-03:00`);
    if (end.getTime() - start.getTime() > 62 * 24 * 60 * 60 * 1000) return Response.json({ error: "El rango es demasiado largo" }, { status: 400 });
    return Response.json(await listCalendarEvents(start, end));
  } catch (error) { return apiError(error); }
}
