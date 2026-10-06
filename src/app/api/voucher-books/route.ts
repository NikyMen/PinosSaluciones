import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { VoucherBook } from "@/lib/models";
import { voucherBooks } from "@/lib/voucher-books";
import { BOOK_VOUCHER_TYPES, isFiscalVoucher } from "@/lib/invoice-labels";

const pointOfSale = z.string().trim().regex(/^\d{1,5}$/, "El punto de venta son hasta 5 números").transform(value => value.padStart(4, "0"));
const bookSchema = z.object({
  company: z.enum(["tvp", "constructora"]),
  scope: z.enum(["venta", "compra"]),
  voucherType: z.enum(BOOK_VOUCHER_TYPES),
  pointOfSale,
  notes: z.string().trim().max(300).optional().default(""),
});

/** Los talonarios de las dos empresas. Los ve y los cambia gerencia. */
export async function GET() {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    await connectDB();
    return Response.json({ items: await voucherBooks() });
  } catch (error) { return apiError(error); }
}

/** Un talonario nuevo (otro punto de venta, o un tipo que la empresa empieza a usar). */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    const parsed = bookSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const book = await VoucherBook.create({ ...parsed.data, fiscal: isFiscalVoucher(parsed.data.voucherType), lastNumber: 0, active: true });
    await audit(session, "create", "voucher_books", book._id, null, book.toObject(), request.headers.get("x-forwarded-for") || undefined);
    return Response.json(book, { status: 201 });
  } catch (error) { return apiError(error); }
}
