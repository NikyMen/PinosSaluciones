import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { Invoice } from "@/lib/models";
import { applyNoteCredit, creditNoteDetail, undoNoteCredit } from "@/lib/credit-notes";
import type { Session } from "@/lib/auth";

const schema = z.object({
  invoiceId: z.string().refine(isValidObjectId, "Elegí la factura"),
  amountCents: z.coerce.number().int().positive("Poné cuánto se aplica"),
});

/** Lo aplica quien factura o quien cobra. */
const allowed = (session: Session) => canWrite(session, "invoices") || canWrite(session, "collections");

/** El saldo a favor de una nota de crédito y a qué facturas se aplicó. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canRead(session, "invoices") && !canRead(session, "collections")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    return Response.json(await creditNoteDetail(id));
  } catch (error) { return apiError(error); }
}

/** Aplica saldo a favor de la nota a una factura pendiente del mismo cliente y la misma empresa. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!allowed(session)) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const before = await Invoice.findById(id).lean();
    const detail = await applyNoteCredit(id, parsed.data, session);
    await audit(session, "update", "invoices", id, before, await Invoice.findById(id).lean(), request.headers.get("x-forwarded-for") || undefined);
    return Response.json(detail, { status: 201 });
  } catch (error) { return apiError(error); }
}

/** Deshace una aplicación (?application=<id>): el saldo vuelve a la nota. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!allowed(session)) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const application = new URL(request.url).searchParams.get("application") || "";
    if (!isValidObjectId(id) || !isValidObjectId(application)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const before = await Invoice.findById(id).lean();
    const detail = await undoNoteCredit(id, application);
    await audit(session, "update", "invoices", id, before, await Invoice.findById(id).lean(), request.headers.get("x-forwarded-for") || undefined);
    return Response.json(detail);
  } catch (error) { return apiError(error); }
}
