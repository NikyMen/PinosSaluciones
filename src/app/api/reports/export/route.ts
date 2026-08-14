import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { entities, type Entity } from "@/lib/constants";
import { modelByEntity } from "@/lib/models";
import { apiError } from "@/lib/api";
import { canRead } from "@/lib/permissions";

function csvCell(value: unknown) { const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value); return `"${text.replaceAll('"', '""')}"`; }

export async function GET(request: Request) {
  try {
    const session = await requireSession(); const value = new URL(request.url).searchParams.get("entity") || "clients";
    if (!entities.includes(value as Entity)) return Response.json({ error: "Módulo inválido" }, { status: 400 });
    if (!canRead(session, value as Entity)) throw new Error("FORBIDDEN");
    await connectDB(); const rows = await modelByEntity[value as Entity].find().sort({ createdAt: -1 }).limit(10000).lean();
    const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const csv = "\uFEFF" + [keys.map(csvCell).join(","), ...rows.map(row => keys.map(key => csvCell((row as Record<string, unknown>)[key])).join(","))].join("\r\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${value}.csv"` } });
  } catch (error) { return apiError(error); }
}
