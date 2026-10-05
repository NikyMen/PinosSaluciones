import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { AuditLog } from "@/lib/models";
import { sanitizeSearch } from "@/lib/schemas";

/**
 * La bitácora completa: quién hizo qué, cuándo, sobre qué registro y qué
 * cambió (valor anterior y nuevo). Solo la mira gerencia.
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    await connectDB();
    const params = new URL(request.url).searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const limit = 50;
    const filter: Record<string, unknown> = {};
    const entity = params.get("entity") || "";
    if (entity) filter.entity = sanitizeSearch(entity);
    const user = sanitizeSearch(params.get("user") || "");
    if (user) filter.$or = [{ userName: { $regex: user, $options: "i" } }, { userEmail: { $regex: user, $options: "i" } }];
    const action = params.get("action") || "";
    if (action) filter.action = sanitizeSearch(action);
    const [items, total, entities] = await Promise.all([
      AuditLog.find(filter).select("userName userEmail action entity entityId before after createdAt ip").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AuditLog.countDocuments(filter),
      AuditLog.distinct("entity"),
    ]);
    return Response.json({ items, entities, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { return apiError(error); }
}
