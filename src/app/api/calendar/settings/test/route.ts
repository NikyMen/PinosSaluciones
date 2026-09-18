import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { testConnection } from "@/lib/google-calendar";

export const runtime = "nodejs";

export async function POST() {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    const result = await testConnection();
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}
