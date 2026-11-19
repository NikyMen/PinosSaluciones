import { Types } from "mongoose";
import { Invoice } from "./models";
import { HttpError } from "./api";
import { audit } from "./audit";
import { beforeCreate } from "./document-rules";
import { applyCreditNote, checkNote, checkSubstitution, completeSubstitution, emitInvoiceInArca, prepareInvoice } from "./invoice-service";
import { attachRemitos, checkRemitosForInvoice, claimRemitos, invoiceRemitoLines, unclaimRemitos } from "./sales-remitos";
import { checkInvoiceExcess } from "./quote-billing-service";
import { closeCertificate } from "./certificate-billing";
import type { Session } from "./auth";

/*
 * El alta de una factura de venta, con todas sus reglas: el talonario, la
 * sustitución de una X, los remitos que factura, el neto y el IVA, las notas,
 * el tope de la cotización y, si se pide, el CAE de ARCA. La usan el alta de
 * Ventas › Facturas de venta (/api/records/invoices) y el Mostrador
 * (src/lib/counter-sales.ts). `data` es lo que validó schemas.invoices.
 */
export async function createInvoice(data: Record<string, unknown>, session: Session, ip?: string) {
  await beforeCreate("invoices", data, session);
  const replaced = await checkSubstitution(data);
  // La factura referencia los remitos de venta que factura: no vuelve a descontar stock.
  await checkRemitosForInvoice(data);
  // La fiscal que sustituye una X factura lo mismo que la X de sus remitos.
  if (replaced) data.remitoLines = replaced.remitoLines;
  await prepareInvoice(data);
  // Una nota de débito o de crédito: con su factura asociada, del mismo cliente y la misma letra.
  await checkNote(data);
  // No pasa de lo que queda por facturar de su cotización, su certificado o sus remitos (salvo que Gerencia lo autorice).
  await checkInvoiceExcess(data, session);
  // Emitir en ARCA: primero se revisa que la factura se pueda guardar, después se pide el CAE.
  const emitInArca = data.arcaEmit === true;
  delete data.arcaEmit;
  // Los remitos se toman antes de emitir y guardar: dos facturas no pueden llevarse el mismo.
  // En una sustitución ya los tiene la X y pasan a la fiscal después de guardarla.
  const remitoIds = Array.isArray(data.remitoIds) ? data.remitoIds : [];
  const remitoLines = invoiceRemitoLines(data);
  const claim = remitoLines.length > 0 && !replaced;
  if (claim) { data._id = new Types.ObjectId(); await claimRemitos(data._id, remitoLines); }
  let item;
  try {
    if (emitInArca) {
      await new Invoice({ ...data, number: data.number || "por-emitir" }).validate();
      await emitInvoiceInArca(data);
    }
    item = await Invoice.create(data as never).catch((error: unknown) => {
      if (!emitInArca) throw error;
      // Ya está autorizada en ARCA: que no se pierda el dato aunque no se haya podido guardar.
      console.error("Factura emitida en ARCA que no se pudo guardar", { company: data.company, number: data.number, cae: data.cae, error });
      throw new HttpError(`La factura quedó emitida en ARCA (${String(data.number)}, CAE ${String(data.cae)}) pero no se pudo guardar en el sistema. Cargala a mano con esos datos.`, 500);
    });
  } catch (error) {
    // Emitida en ARCA, los remitos quedan tomados: la factura existe aunque haya que cargarla a mano.
    if (claim && !data.cae) await unclaimRemitos(data._id, remitoLines);
    throw error;
  }

  if (replaced) await completeSubstitution(replaced, item);
  if (remitoIds.length && !claim) await attachRemitos(item._id, remitoIds, replaced?._id);
  // La nota de crédito descuenta su importe de lo que se debe de la factura asociada.
  await applyCreditNote(item.toObject(), 1);
  if (item.workId && (item.certificateId || item.certificateNumber)) await closeCertificate(item.toObject());
  await audit(session, "create", "invoices", item._id, null, item.toObject(), ip);
  return item;
}
