import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { PriceList } from "@/lib/models";
import { searchPrices } from "@/lib/price-list-service";

/** El buscador de precios: un producto en las listas vigentes de todos los proveedores. */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canRead(session, "suppliers")) throw new Error("FORBIDDEN");
    const query = new URL(request.url).searchParams.get("q")?.slice(0, 120) || "";
    await connectDB();
    const [result, lists] = await Promise.all([searchPrices(query), PriceList.countDocuments({ current: true })]);
    return Response.json({ ...result, lists });
  } catch (error) { return apiError(error); }
}
