import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { documentThread, THREAD_KINDS, type ThreadKind } from "@/lib/document-thread";

/** El historial del hilo de un documento: todo lo vinculado, en orden de fecha. Ver src/lib/document-thread.ts. */
export async function GET(_request: Request, context: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const session = await requireSession();
    const { kind, id } = await context.params;
    if (!THREAD_KINDS.includes(kind as ThreadKind)) return Response.json({ error: "Documento desconocido" }, { status: 404 });
    await connectDB();
    return Response.json(await documentThread(kind as ThreadKind, id, session));
  } catch (error) { return apiError(error); }
}
