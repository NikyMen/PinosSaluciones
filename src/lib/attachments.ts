import { Types } from "mongoose";
import { CashMovement, Expense, Payment, Purchase, PurchaseReceipt } from "./models";
import { HttpError } from "./api";
import { canRead, canWrite } from "./permissions";
import { notify } from "./notifications";
import type { Entity } from "./constants";
import type { Session } from "./auth";

/*
 * Los adjuntos de los documentos de compras y Tesorería (requerimiento
 * integral v4, puntos 3 y 5): se ven, se descargan y se reemplazan, pero no se
 * borran. Cada uno guarda su nombre original, quién lo subió y cuándo; el que se
 * reemplaza queda en el historial con quién y cuándo lo reemplazó.
 *
 * El archivo único de antes (`attachment`) se muestra como el primero.
 */

export const ATTACHMENT_ENTITIES = { purchases: Purchase, payments: Payment, expenses: Expense, cash: CashMovement, purchaseReceipts: PurchaseReceipt } as const;
export type AttachmentEntity = keyof typeof ATTACHMENT_ENTITIES;

/** El permiso de cada uno: un remito de compra es de Compras. */
const permissionOf: Record<AttachmentEntity, Entity> = { purchases: "purchases", payments: "payments", expenses: "expenses", cash: "cash", purchaseReceipts: "purchases" };

export type FileRef = { _id?: string; path: string; name?: string; size?: number; label?: string; uploadedAt?: string | Date; uploadedByName?: string; replacedAt?: string | Date; replacedByName?: string; legacy?: boolean };

export function isAttachmentEntity(value: string): value is AttachmentEntity {
  return value in ATTACHMENT_ENTITIES;
}

/** Los adjuntos de un documento, con el archivo único de antes al principio. */
export function filesOf(doc: Record<string, unknown> | null | undefined): FileRef[] {
  if (!doc) return [];
  const files = (Array.isArray(doc.files) ? doc.files : []) as FileRef[];
  const legacy = typeof doc.attachment === "string" && doc.attachment && !files.some(file => file.path === doc.attachment)
    ? [{ path: doc.attachment, name: "Comprobante", legacy: true, uploadedAt: (doc.createdAt as Date | undefined) }]
    : [];
  return [...legacy, ...files.map(file => ({ ...file, _id: file._id ? String(file._id) : undefined }))];
}

async function documentFor(entity: AttachmentEntity, id: string) {
  if (!Types.ObjectId.isValid(id)) throw new HttpError("ID inválido");
  const doc = await (ATTACHMENT_ENTITIES[entity] as typeof Purchase).findById(id).lean<Record<string, unknown>>();
  if (!doc) throw new HttpError("No encontrado", 404);
  return doc;
}

export async function listAttachments(entity: AttachmentEntity, id: string, session: Session) {
  if (!canRead(session, permissionOf[entity])) throw new Error("FORBIDDEN");
  return filesOf(await documentFor(entity, id));
}

/** Suma un archivo (o reemplaza uno, que queda en el historial). */
export async function addAttachment(entity: AttachmentEntity, id: string, input: { path: string; name?: string; size?: number; label?: string; replaces?: string }, session: Session) {
  if (!canWrite(session, permissionOf[entity])) throw new Error("FORBIDDEN");
  const doc = await documentFor(entity, id);
  const model = ATTACHMENT_ENTITIES[entity] as typeof Purchase;
  const file = { _id: new Types.ObjectId(), path: input.path, name: input.name || "Archivo", size: input.size, label: input.label, uploadedAt: new Date(), uploadedById: session.userId, uploadedByName: session.name };
  if (input.replaces === "legacy") {
    // El archivo único de antes pasa al historial como reemplazado.
    const legacy = filesOf(doc).find(entry => entry.legacy);
    if (!legacy) throw new HttpError("No hay archivo para reemplazar");
    await model.updateOne({ _id: id }, { $push: { files: { $each: [{ path: legacy.path, name: legacy.name, uploadedAt: legacy.uploadedAt, replacedAt: new Date(), replacedByName: session.name }, file] } }, $unset: { attachment: "" } });
  } else if (input.replaces) {
    // El mismo elemento: que exista y que no esté ya reemplazado.
    const result = await model.updateOne({ _id: id, files: { $elemMatch: { _id: input.replaces, replacedAt: { $exists: false } } } }, { $set: { "files.$.replacedAt": new Date(), "files.$.replacedByName": session.name } });
    if (!result.modifiedCount) throw new HttpError("El archivo a reemplazar no existe o ya se reemplazó", 409);
    await model.updateOne({ _id: id }, { $push: { files: file } });
  } else await model.updateOne({ _id: id }, { $push: { files: file } });
  // Un comprobante de pago de una compra: Compras se entera, con el link a la OC.
  if (entity === "payments" && doc.purchaseId) await notify({
    title: `Comprobante de la ${String(doc.number || "orden de pago")}`, body: `${input.name || "Archivo"} · lo cargó ${session.name}.`,
    kind: "compra", href: `/app/purchases?ver=${String(doc.purchaseId)}`, roles: ["compras"], event: "compra.pago", dedupeKey: `payment-file-${String(file._id)}`,
  });
  return filesOf(await model.findById(id).lean<Record<string, unknown>>());
}
