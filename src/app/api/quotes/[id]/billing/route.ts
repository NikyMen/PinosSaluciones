import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { apiError } from "@/lib/api";
import { invoiceLabel } from "@/lib/invoice-labels";
import { invoiceNetCents, type BillingInvoice } from "@/lib/quote-billing";
import { remitoPendingCents, type RemitoLike } from "@/lib/remito-billing";
import { loadQuoteBilling } from "@/lib/quote-billing-service";

/** La facturación de la cotización: vigente, facturado, pendiente y habilitado (en neto), con las facturas que la aplican. */
export async function GET(_request: Request, context: RouteContext<"/api/quotes/[id]/billing">) {
  try {
    const session = await requireSession();
    if (!canRead(session, "quotes")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const loaded = await loadQuoteBilling(id);
    if (!loaded) return Response.json({ error: "Cotización no encontrada" }, { status: 404 });
    const { quote, works, invoices, remitos, billing } = loaded;
    return Response.json({
      billing,
      adjustments: (quote.adjustments || []).map(item => ({ ...item, _id: String(item._id) })),
      invoices: invoices.map(invoice => ({
        _id: String(invoice._id), label: invoiceLabel(invoice), issueDate: invoice.issueDate, status: invoice.status,
        netCents: invoiceNetCents(invoice as BillingInvoice), amountCents: Number(invoice.amountCents || 0),
        workId: invoice.workId ? String(invoice.workId) : null, certificateNumber: invoice.certificateNumber || null,
        remitos: Array.isArray(invoice.remitoIds) ? invoice.remitoIds.length : 0,
      })),
      // Lo que habilita a facturar: certificados aprobados sin facturar y remitos pendientes.
      certificates: works.flatMap(work => (work.certificates || []).filter(certificate => certificate.approved && !certificate.invoiced)
        .map(certificate => ({ _id: String(certificate._id), workId: String(work._id), workCode: work.code, number: certificate.number, amountCents: Number(certificate.amountCents || 0) }))),
      remitos: remitos.map(remito => ({ _id: String(remito._id), number: remito.number, status: remito.status, pendingCents: remitoPendingCents(remito as RemitoLike) })),
      works: works.map(work => ({ _id: String(work._id), code: work.code, name: work.name })),
    });
  } catch (error) { return apiError(error); }
}
