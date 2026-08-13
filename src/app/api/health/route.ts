import { connectDB } from "@/lib/db";
export async function GET() {
  try { const db = await connectDB(); return Response.json({ status: "ok", database: db.connection.readyState === 1 ? "connected" : "unavailable", timestamp: new Date().toISOString() }); }
  catch { return Response.json({ status: "degraded", database: "unavailable" }, { status: 503 }); }
}
