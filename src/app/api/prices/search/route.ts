import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { PriceList } from "@/lib/models";
import { searchPrices, type PriceSort } from "@/lib/price-list-service";

const sorts: PriceSort[] = ["relevance", "price", "unit"];

/** El buscador de precios: un producto (o la lista entera) en las listas vigentes de todos los proveedores. */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "suppliers")) throw new Error("FORBIDDEN");
    const params = new URL(request.url).searchParams;
    const query = params.get("q")?.slice(0, 120) || "";
    const offset = Math.max(0, Number(params.get("offset")) || 0);
    const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 100));
    const sort = sorts.find(value => value === params.get("sort")) || "relevance";
    await connectDB();
    const [result, lists] = await Promise.all([searchPrices(query, { offset, limit, sort }), PriceList.countDocuments({ current: true })]);
    return Response.json({ ...result, lists, offset });
  } catch (error) { return apiError(error); }
}
