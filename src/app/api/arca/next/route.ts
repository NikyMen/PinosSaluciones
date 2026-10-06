import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError, HttpError } from "@/lib/api";
import { arcaCredentials, arcaNextNumber } from "@/lib/arca";
import { COMPANY_KEYS, type CompanyKey } from "@/lib/companies";
import { ARCA_VOUCHER_CODE, type ArcaVoucherType } from "@/lib/fiscal";

/**
 * El número que sigue en ARCA para un comprobante (?empresa=constructora&tipo=factura_a):
 * el último autorizado + 1, en el punto de venta por el que emite la empresa.
 * Lo usa el formulario de la factura para mostrarlo antes de emitir.
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "invoices")) throw new Error("FORBIDDEN");
    const url = new URL(request.url);
    const company = url.searchParams.get("empresa") as CompanyKey;
    const voucherType = url.searchParams.get("tipo") as ArcaVoucherType;
    if (!COMPANY_KEYS.includes(company) || !(voucherType in ARCA_VOUCHER_CODE)) throw new HttpError("Empresa o comprobante inválido");
    if (!arcaCredentials(company)) throw new HttpError("La empresa no está conectada con ARCA");
    await connectDB();
    return Response.json(await arcaNextNumber(company, voucherType));
  } catch (error) { return apiError(error); }
}
