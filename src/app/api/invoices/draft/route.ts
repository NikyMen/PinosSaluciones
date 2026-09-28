import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Invoice, Work } from "@/lib/models";
import { apiError } from "@/lib/api";
import { todayIso } from "@/lib/format";

/** El número que sigue al de la última factura cargada: "0001-00000123" -> "0001-00000124". */
async function nextInvoiceNumber() {
  const last = await Invoice.findOne({}, { number: 1 }).sort({ createdAt: -1 }).lean<{ number?: string }>();
  const match = String(last?.number || "").match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return "";
  const [, prefix, digits, suffix] = match;
  return `${prefix}${String(Number(digits) + 1).padStart(digits.length, "0")}${suffix}`;
}

/**
 * Los datos con los que se abre una factura nueva: el número sugerido y, si
 * viene de un certificado (?obra=&certificado=), la obra, su cliente y el importe.
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "invoices")) throw new Error("FORBIDDEN");
    await connectDB();
    const url = new URL(request.url);
    const workId = url.searchParams.get("obra") || "";
    const certificateNumber = url.searchParams.get("certificado") || "";
    const draft: Record<string, unknown> = { number: await nextInvoiceNumber() };
    if (workId && certificateNumber && isValidObjectId(workId)) {
      const work = await Work.findById(workId, { code: 1, name: 1, clientId: 1, certificates: 1 }).lean<{ code: string; name: string; clientId?: unknown; certificates?: Array<{ number?: string; period?: string; percentage?: number; amountCents?: number }> }>();
      const certificate = work?.certificates?.find(item => String(item.number) === certificateNumber);
      if (work && certificate) Object.assign(draft, {
        clientId: work.clientId ? String(work.clientId) : "",
        workId,
        certificateNumber,
        amountCents: Number(certificate.amountCents || 0),
        issueDate: todayIso(),
        description: `Certificado ${certificateNumber}${certificate.period ? ` — ${certificate.period}` : ""} · Obra ${work.code} — ${work.name} · Avance ${Number(certificate.percentage || 0)}%`,
      });
    }
    return Response.json(draft);
  } catch (error) { return apiError(error); }
}
