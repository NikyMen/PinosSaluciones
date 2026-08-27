import { connectDB } from "@/lib/db";
import { Notification } from "@/lib/models";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    await connectDB();
    const now = new Date();
    const includeDone = new URL(request.url).searchParams.get("history") === "1";
    const mine = { roles: session.role };

    // Activas = pendientes + las pospuestas cuyo recordatorio ya llegó.
    const activeFilter = { ...mine, $or: [{ status: "pendiente" }, { status: "pospuesta", remindAt: { $lte: now } }] };
    const [active, history] = await Promise.all([
      Notification.find(activeFilter).sort({ createdAt: -1 }).limit(50).lean(),
      includeDone ? Notification.find(mine).sort({ createdAt: -1 }).limit(100).lean() : Promise.resolve([]),
    ]);
    return Response.json({ items: active, unread: active.length, history });
  } catch (error) { return apiError(error); }
}
