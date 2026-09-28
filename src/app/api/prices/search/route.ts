import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { PriceList, PriceListItem, Supplier } from "@/lib/models";
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
    const supplier = params.get("supplier") || "";
    const supplierId = /^[a-f\d]{24}$/i.test(supplier) ? supplier : "";
    await connectDB();
    const [result, lists, withPrices] = await Promise.all([
      searchPrices(query, { offset, limit, sort, supplierId }),
      PriceList.countDocuments({ current: true }),
      PriceListItem.distinct("supplierId", { current: true }),
    ]);
    // Para el filtro: los proveedores activos que tienen productos cargados.
    const suppliers = await Supplier.find({ _id: { $in: withPrices }, active: { $ne: false } }).select("name").sort({ name: 1 }).lean() as Array<{ _id: unknown; name: string }>;
    return Response.json({ ...result, lists, offset, suppliers: suppliers.map(item => ({ _id: String(item._id), name: item.name })) });
  } catch (error) { return apiError(error); }
}
