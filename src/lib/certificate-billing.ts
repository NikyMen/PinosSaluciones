import { Invoice, Notification, Task, Work } from "./models";
import { VOID_INVOICE_STATUSES } from "./invoice-labels";

/*
 * La factura de un certificado de obra. Al facturarlo se marca en la obra y se
 * cierran la tarea y el aviso de "listo para facturar". Si esa factura después
 * se anula o se borra, el certificado vuelve a quedar pendiente de facturar,
 * salvo que otra factura vigente lo tenga.
 */

type InvoiceLike = { _id?: unknown; workId?: unknown; certificateId?: unknown; certificateNumber?: unknown };
type CertificateRow = { _id?: unknown; number?: string };

async function findCertificate(invoice: InvoiceLike) {
  if (!invoice.workId || !(invoice.certificateId || invoice.certificateNumber)) return null;
  const work = await Work.findById(invoice.workId).select("certificates._id certificates.number").lean<{ _id: unknown; certificates?: CertificateRow[] }>();
  const certificates = work?.certificates || [];
  const certificate = (invoice.certificateId ? certificates.find(item => String(item._id) === String(invoice.certificateId)) : undefined)
    ?? (invoice.certificateNumber ? certificates.find(item => String(item.number) === String(invoice.certificateNumber)) : undefined);
  return work && certificate ? { workId: String(work._id), certificate } : null;
}

function escape(text: string) { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** La tarea y el aviso del certificado: se cierran al facturarlo y se reabren si la factura se cae. */
async function setFollowUp(workId: string, number: string, open: boolean) {
  await Promise.all([
    Task.updateMany({ type: "facturar_certificado", relatedId: workId, status: open ? "completada" : { $ne: "completada" }, title: { $regex: `^Facturar certificado ${escape(number)} —` } }, { $set: { status: open ? "pendiente" : "completada" } }),
    Notification.updateMany({ dedupeKey: `certificate-${workId}-${number}` }, { $set: { status: open ? "pendiente" : "hecha" } }),
  ]);
}

/** Facturado el certificado: queda marcado en la obra y se cierran su tarea y su aviso. */
export async function closeCertificate(invoice: InvoiceLike) {
  const found = await findCertificate(invoice);
  if (!found) return;
  await Work.updateOne({ _id: found.workId, "certificates._id": found.certificate._id }, { $set: { "certificates.$.invoiced": true } });
  // Queda atada por id aunque se haya elegido por número.
  if (invoice._id && !invoice.certificateId) await Invoice.updateOne({ _id: invoice._id }, { $set: { certificateId: found.certificate._id } });
  await setFollowUp(found.workId, String(found.certificate.number || ""), false);
}

/** La factura del certificado se anuló o se borró: vuelve a estar pendiente de facturar si ninguna otra lo factura. */
export async function reopenCertificate(invoice: InvoiceLike) {
  const found = await findCertificate(invoice);
  if (!found) return;
  const other = await Invoice.exists({
    _id: { $ne: invoice._id }, workId: found.workId, status: { $nin: VOID_INVOICE_STATUSES },
    $or: [{ certificateId: found.certificate._id }, { certificateId: { $exists: false }, certificateNumber: found.certificate.number }],
  });
  if (other) return;
  await Work.updateOne({ _id: found.workId, "certificates._id": found.certificate._id }, { $set: { "certificates.$.invoiced": false } });
  await setFollowUp(found.workId, String(found.certificate.number || ""), true);
}
