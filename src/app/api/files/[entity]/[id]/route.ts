import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { addAttachment, isAttachmentEntity, listAttachments } from "@/lib/attachments";

const schema = z.object({
  path: z.string().regex(/^\/api\/uploads\/[\w.-]+$/, "Subí el archivo primero"),
  name: z.string().trim().max(200).optional(),
  size: z.coerce.number().int().min(0).optional(),
  label: z.string().trim().max(80).optional(),
  // El id del adjunto que reemplaza ("legacy" para el archivo único de antes).
  replaces: z.string().regex(/^([a-f\d]{24}|legacy)$/i).optional(),
});

/** Los adjuntos de un documento, con los reemplazados (historial). */
export async function GET(_request: Request, context: RouteContext<"/api/files/[entity]/[id]">) {
  try {
    const session = await requireSession();
    const { entity, id } = await context.params;
    if (!isAttachmentEntity(entity)) return Response.json({ error: "No encontrado" }, { status: 404 });
    await connectDB();
    return Response.json({ items: await listAttachments(entity, id, session) });
  } catch (error) { return apiError(error); }
}

/** Suma un adjunto o reemplaza uno: el reemplazado no se borra, queda en el historial. */
export async function POST(request: Request, context: RouteContext<"/api/files/[entity]/[id]">) {
  try {
    const session = await requireSession();
    const { entity, id } = await context.params;
    if (!isAttachmentEntity(entity)) return Response.json({ error: "No encontrado" }, { status: 404 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const items = await addAttachment(entity, id, parsed.data, session);
    await audit(session, parsed.data.replaces ? "replace_file" : "add_file", entity, id, null, { ...parsed.data }, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ items }, { status: 201 });
  } catch (error) { return apiError(error); }
}
