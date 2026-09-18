import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { disconnect } from "@/lib/google-calendar";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    await disconnect();
    await audit(session, "disconnect", "calendario", "main", null, null, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
