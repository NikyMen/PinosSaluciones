import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Work } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";

const uploadPath = z.string().regex(/^\/api\/uploads\/[\w.-]+$/, "Archivo inválido");
const schema = z.object({ files: z.array(z.object({ path: uploadPath, name: z.string().trim().max(200).optional().default("") })).min(1).max(20) });

type Params = RouteContext<"/api/works/[id]/certificates/[certificateId]/files">;

async function target(context: Params) {
  const { id, certificateId } = await context.params;
  if (!isValidObjectId(id) || !isValidObjectId(certificateId)) return null;
  return { id, certificateId };
}

/** Suma archivos a un certificado que ya existe: el PDF firmado, fotos, la planilla. */
export async function POST(request: Request, context: Params) {
  try {
    const session = await requireSession(); if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const ids = await target(context); if (!ids) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Archivos inválidos" }, { status: 400 });
    await connectDB();
    const files = parsed.data.files.map(file => ({ ...file, uploadedAt: new Date(), uploadedByName: session.name }));
    const work = await Work.findOneAndUpdate({ _id: ids.id, "certificates._id": ids.certificateId }, { $push: { "certificates.$.files": { $each: files } } }, { returnDocument: "after" });
    if (!work) return Response.json({ error: "Certificado no encontrado" }, { status: 404 });
    await audit(session, "add_certificate_files", "works", ids.id, null, { certificateId: ids.certificateId, files });
    return Response.json(work, { status: 201 });
  } catch (error) { return apiError(error); }
}

/** Saca un archivo del certificado. El archivo en sí queda guardado en el servidor, por las dudas. */
export async function DELETE(request: Request, context: Params) {
  try {
    const session = await requireSession(); if (!canWrite(session, "works")) throw new Error("FORBIDDEN");
    const ids = await target(context); if (!ids) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = uploadPath.safeParse(new URL(request.url).searchParams.get("path") || "");
    if (!parsed.success) return Response.json({ error: "Archivo inválido" }, { status: 400 });
    await connectDB();
    // El archivo viejo (`file`) también se puede sacar.
    const work = await Work.findOneAndUpdate(
      { _id: ids.id, "certificates._id": ids.certificateId },
      { $pull: { "certificates.$.files": { path: parsed.data } } },
      { returnDocument: "after" },
    );
    if (!work) return Response.json({ error: "Certificado no encontrado" }, { status: 404 });
    await Work.updateOne({ _id: ids.id, certificates: { $elemMatch: { _id: ids.certificateId, file: parsed.data } } }, { $set: { "certificates.$.file": "" } });
    await audit(session, "remove_certificate_file", "works", ids.id, null, { certificateId: ids.certificateId, path: parsed.data });
    return Response.json(await Work.findById(ids.id));
  } catch (error) { return apiError(error); }
}
