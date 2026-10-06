import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { arcaStatus } from "@/lib/arca";
import { COMPANY_KEYS, type CompanyKey } from "@/lib/companies";

/**
 * Prueba la conexión con ARCA de una empresa (?empresa=constructora) o de las
 * dos: entra con su certificado y consulta puntos de venta y últimos números.
 * No emite nada. La usa gerencia desde Configuración > Empresas y comprobantes.
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    await connectDB();
    const asked = new URL(request.url).searchParams.get("empresa");
    const companies = COMPANY_KEYS.filter(key => !asked || key === asked) as CompanyKey[];
    return Response.json({ items: await Promise.all(companies.map(arcaStatus)) });
  } catch (error) { return apiError(error); }
}
