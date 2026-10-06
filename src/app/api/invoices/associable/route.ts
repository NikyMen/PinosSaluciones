import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { Invoice } from "@/lib/models";
import { companyOf } from "@/lib/companies";
import { baseInvoiceType, CREDIT_NOTE_TYPES, invoiceLabel, isCreditNote, VOID_INVOICE_STATUSES } from "@/lib/invoice-labels";

/**
 * Las facturas a las que se puede asociar una nota (?cliente=&empresa=&tipo=nota_credito_a):
 * del cliente y la empresa, de la misma letra, no anuladas. Para una nota de
 * crédito, solo las que tienen algo por cobrar (no puede ser por más).
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "invoices")) throw new Error("FORBIDDEN");
    const url = new URL(request.url);
    const clientId = url.searchParams.get("cliente") || "";
    const voucherType = url.searchParams.get("tipo") || "";
    if (!isValidObjectId(clientId)) return Response.json({ items: [] });
    const company = companyOf(url.searchParams.get("empresa")).key;
    const base = baseInvoiceType(voucherType);
    await connectDB();
    // Al editar una nota, su factura asociada aparece siempre (aunque ya no tenga saldo).
    const keep = url.searchParams.get("incluir") || "";
    const invoices = await Invoice.find({
      clientId, company: company === "tvp" ? { $in: ["tvp", null] } : company,
      voucherType: { $in: [base, base.replace("factura_", "nota_debito_")], $nin: CREDIT_NOTE_TYPES },
      status: { $nin: VOID_INVOICE_STATUSES },
    }).sort({ issueDate: -1 }).limit(100).lean<Array<Record<string, unknown>>>();
    const items = invoices
      .map(invoice => ({ _id: String(invoice._id), label: invoiceLabel(invoice), issueDate: invoice.issueDate, amountCents: Number(invoice.amountCents || 0), pendingCents: Math.max(0, Number(invoice.amountCents || 0) - Number(invoice.collectedCents || 0)) }))
      .filter(invoice => !isCreditNote(voucherType) || invoice.pendingCents > 0 || invoice._id === keep);
    return Response.json({ items });
  } catch (error) { return apiError(error); }
}
