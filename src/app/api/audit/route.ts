import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { AuditLog } from "@/lib/models";
import { entities, type Entity } from "@/lib/constants";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { apiError } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const entity = url.searchParams.get("entity") || "";
    const entityId = url.searchParams.get("entityId") || "";
    if (!entities.includes(entity as Entity) || !canRead(session, entity as Entity)) throw new Error("FORBIDDEN");
    if (!isValidObjectId(entityId)) return Response.json({ error: "ID inválido" }, { status: 400 });

    await connectDB();
    const items = await AuditLog.find({ entity, entityId })
      .select("userName userEmail action before after createdAt")
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    return Response.json({ items });
  } catch (error) {
    return apiError(error);
  }
}
