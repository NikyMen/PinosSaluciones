import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Quote, SalesRemito, Work } from "@/lib/models";
import { apiError } from "@/lib/api";
import { todayIso } from "@/lib/format";
import { COMPANY_KEYS, type CompanyKey } from "@/lib/companies";
import { peekInternalNumber, suggestFiscalNumber, voucherBooks } from "@/lib/voucher-books";
import { baseInvoiceType, isNote, SALES_VOUCHER_TYPES, type VoucherType } from "@/lib/invoice-labels";
import { arcaCredentials } from "@/lib/arca";

/**
 * Los datos con los que se abre una factura nueva: qué comprobantes tiene
 * habilitados cada empresa (sus talonarios de venta), el número que sigue en
 * cada uno y, si viene de un certificado (?obra=&certificado=), la obra, su
 * cliente y el importe. Las fiscales siguen la numeración de Tango; la X, la de
 * su talonario interno.
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "invoices")) throw new Error("FORBIDDEN");
    await connectDB();
    const url = new URL(request.url);
    const workId = url.searchParams.get("obra") || "";
    // El certificado llega por id; los avisos de antes traen su número.
    const certificateRef = url.searchParams.get("certificado") || "";
    // Facturar remitos de venta (?remitos=id1,id2): del mismo cliente y la misma empresa.
    const remitoIds = (url.searchParams.get("remitos") || "").split(",").filter(isValidObjectId);

    const books = (await voucherBooks({ scope: "venta", active: true }));
    // Con la Factura A habilitada van también sus notas de débito y crédito (lo mismo con la B), en el orden de siempre.
    const types = Object.fromEntries(COMPANY_KEYS.map(company => {
      const enabled = new Set(books.filter(book => book.company === company).map(book => book.voucherType as string));
      return [company, SALES_VOUCHER_TYPES.filter(type => enabled.has(type) || (isNote(type) && enabled.has(baseInvoiceType(type))))];
    })) as Record<CompanyKey, VoucherType[]>;
    const numbers = Object.fromEntries(await Promise.all(COMPANY_KEYS.map(async company => {
      const byType = await Promise.all(types[company].map(async type => {
        const book = books.find(candidate => candidate.company === company && candidate.voucherType === baseInvoiceType(type));
        return [type, type === "factura_x" ? await peekInternalNumber(company, book?.pointOfSale) : await suggestFiscalNumber(company, type, book?.pointOfSale)] as const;
      }));
      return [company, Object.fromEntries(byType)] as const;
    })));
    const pointsOfSale = Object.fromEntries(COMPANY_KEYS.map(company => [company, Object.fromEntries(types[company].map(type => [type, books.find(book => book.company === company && book.voucherType === baseInvoiceType(type))?.pointOfSale || "0001"]))]));

    const firstType = types.tvp.includes("factura_a") ? "factura_a" : types.tvp[0] || "factura_a";
    // Las empresas con certificado de ARCA en el servidor: sus A y B se emiten desde acá, con CAE.
    const arca = Object.fromEntries(COMPANY_KEYS.map(company => [company, Boolean(arcaCredentials(company))]));
    const draft: Record<string, unknown> = { company: "tvp", voucherType: firstType, number: numbers.tvp?.[firstType] || "", numbers, types, pointsOfSale, arca, vatPct: 21 };
    if (workId && certificateRef && isValidObjectId(workId)) {
      const work = await Work.findById(workId, { code: 1, name: 1, clientId: 1, quoteId: 1, certificates: 1 }).lean<{ code: string; name: string; clientId?: unknown; quoteId?: unknown; certificates?: Array<{ _id?: unknown; number?: string; period?: string; percentage?: number; amountCents?: number }> }>();
      const certificate = work?.certificates?.find(item => String(item._id) === certificateRef) || work?.certificates?.find(item => String(item.number) === certificateRef);
      const certificateNumber = String(certificate?.number || certificateRef);
      // La empresa es la que tiene cargada la cotización de la obra.
      const quote = work?.quoteId ? await Quote.findById(work.quoteId).select("company").lean<{ company?: string }>() : null;
      if (quote?.company && COMPANY_KEYS.includes(quote.company as CompanyKey)) Object.assign(draft, { company: quote.company, number: numbers[quote.company as CompanyKey]?.[firstType] || "" });
      if (work && certificate) Object.assign(draft, {
        clientId: work.clientId ? String(work.clientId) : "",
        workId, quoteId: work.quoteId ? String(work.quoteId) : "",
        certificateNumber, certificateId: certificate._id ? String(certificate._id) : "",
        // El certificado va sin IVA: es el neto de la factura.
        netCents: Number(certificate.amountCents || 0),
        issueDate: todayIso(),
        description: `Certificado ${certificateNumber}${certificate.period ? ` — ${certificate.period}` : ""} · Obra ${work.code} — ${work.name} · Avance ${Number(certificate.percentage || 0)}%`,
      });
    }
    if (remitoIds.length) {
      const remitos = await SalesRemito.find({ _id: { $in: remitoIds }, kind: "salida", status: "pendiente" }).sort({ date: 1 }).lean<Array<{ _id: unknown; number: string; company: CompanyKey; clientId: unknown; quoteId?: unknown; totalCents: number }>>();
      const first = remitos[0];
      if (first) {
        const same = remitos.filter(remito => String(remito.clientId) === String(first.clientId) && remito.company === first.company);
        Object.assign(draft, {
          company: first.company, number: numbers[first.company]?.[firstType] || "", clientId: String(first.clientId),
          quoteId: first.quoteId ? String(first.quoteId) : "",
          // El precio del remito es el neto: la A le suma el IVA; la X no lo discrimina.
          netCents: same.reduce((total, remito) => total + Number(remito.totalCents || 0), 0),
          remitoIds: same.map(remito => String(remito._id)), issueDate: todayIso(),
          description: `Remito${same.length > 1 ? "s" : ""} ${same.map(remito => remito.number).join(", ")}`,
        });
      }
    }
    return Response.json(draft);
  } catch (error) { return apiError(error); }
}
