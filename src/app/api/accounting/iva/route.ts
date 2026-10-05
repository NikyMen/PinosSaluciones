import { requireSession } from "@/lib/auth";
import { canViewSection } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { ivaBook } from "@/lib/accounting";
import { periodFrom } from "@/lib/period";

/** Libro IVA ventas y compras del período: solo comprobantes fiscales, nunca la X. */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canViewSection(session, "accounting")) throw new Error("FORBIDDEN");
    await connectDB();
    return Response.json(await ivaBook(periodFrom(new URL(request.url).searchParams)));
  } catch (error) { return apiError(error); }
}
