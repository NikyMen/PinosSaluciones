import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { counterCatalog } from "@/lib/counter-sales";
import { SALE_SOURCES } from "@/lib/sales-remitos";

/** El catálogo del Mostrador: GET ?search=&from=auto|salon|central. Ver counterCatalog. */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "stock")) throw new Error("FORBIDDEN");
    const params = new URL(request.url).searchParams;
    const from = SALE_SOURCES.find(source => source === params.get("from")) || "auto";
    await connectDB();
    return Response.json(await counterCatalog((params.get("search") || "").slice(0, 100), from));
  } catch (error) { return apiError(error); }
}
