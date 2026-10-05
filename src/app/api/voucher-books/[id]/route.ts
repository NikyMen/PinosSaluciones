import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { apiError, HttpError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { Invoice, VoucherBook } from "@/lib/models";
import { formatVoucherNumber } from "@/lib/invoice-labels";

const changesSchema = z.object({
  active: z.boolean().optional(),
  notes: z.string().trim().max(300).optional(),
  // Solo en un talonario interno (X): desde qué número sigue. No puede volver atrás de uno ya usado.
  lastNumber: z.coerce.number().int().min(0).max(99_999_999).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = changesSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const before = await VoucherBook.findById(id).lean<{ fiscal?: boolean; company: string; pointOfSale: string; lastNumber?: number }>();
    if (!before) return Response.json({ error: "Talonario no encontrado" }, { status: 404 });
    const changes = parsed.data;
    if (changes.lastNumber !== undefined) {
      if (before.fiscal) throw new HttpError("La numeración de un comprobante fiscal la lleva Tango/ARCA, no el sistema");
      // Que el próximo número no choque con una X ya emitida.
      const used = await Invoice.exists({ company: before.company === "tvp" ? { $in: ["tvp", null] } : before.company, number: `X-${formatVoucherNumber(before.pointOfSale, changes.lastNumber + 1)}` });
      if (used) throw new HttpError("Ese número ya se usó en una Factura X: elegí uno más alto");
    }
    const book = await VoucherBook.findByIdAndUpdate(id, { $set: changes }, { returnDocument: "after", runValidators: true }).lean();
    await audit(session, "update", "voucher_books", id, before, book, request.headers.get("x-forwarded-for") || undefined);
    return Response.json(book);
  } catch (error) { return apiError(error); }
}
