import { Types } from "mongoose";
import { HttpError } from "./api";
import { AuditLog, Collection, CounterSale, Expense, Invoice, Payment, Purchase, PurchaseReceipt, Quote, SalesRemito, Work } from "./models";
import { canRead } from "./permissions";
import { invoiceLabel, isCreditNote } from "./invoice-labels";
import { purchaseStatusText } from "./purchase-flow-labels";
import type { Session } from "./auth";

/*
 * El historial del hilo de documentos (pedido del 23/11/2026, sobre el circuito
 * que dibujó Fer el 10/11): desde cualquier comprobante se ve todo lo que está
 * atado a él, en orden de fecha, en los cuatro conjuntos (Cotización / Obra,
 * Compras, Ventas y Tesorería). No guarda nada: recorre los vínculos que ya
 * tienen los documentos, en los dos sentidos, porque se pueden cargar en
 * cualquier orden (la factura antes que la OC, la OP antes que la factura).
 * Lo que se asoció después sale de la bitácora. Ver docs/plan-historial-de-documentos.md.
 */

export const THREAD_KINDS = ["quote", "work", "purchase", "purchase_receipt", "expense", "sales_remito", "invoice", "counter_sale", "payment", "collection"] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];
export type ThreadGroup = "cotizacion" | "compras" | "ventas" | "tesoreria";

export const THREAD_GROUPS: Record<ThreadGroup, string> = { cotizacion: "Cotización / Obra", compras: "Compras", ventas: "Ventas", tesoreria: "Tesorería" };

export type ThreadEvent = { at: string; userName?: string; label: string };
export type ThreadNode = {
  kind: ThreadKind; id: string; group: ThreadGroup; type: string; number: string; title?: string;
  date: string; createdAt?: string; userName?: string; amountCents?: number; status?: string; voided: boolean;
  href: string; root: boolean; events: ThreadEvent[];
};
export type DocumentThread = {
  nodes: ThreadNode[]; hidden: Partial<Record<ThreadGroup, number>>; truncated: boolean;
  totals: { quotedCents: number; orderedCents: number; billedPurchasesCents: number; paidCents: number; billedSalesCents: number; collectedCents: number };
};

type Doc = Record<string, unknown> & { _id: Types.ObjectId; createdAt?: Date };
type Ref = { kind: ThreadKind; id: string };

/** Hasta dónde se recorre: una obra grande puede tener cientos de compras. */
export const THREAD_LIMIT = 200;

const models = {
  quote: Quote, work: Work, purchase: Purchase, purchase_receipt: PurchaseReceipt, expense: Expense,
  sales_remito: SalesRemito, invoice: Invoice, counter_sale: CounterSale, payment: Payment, collection: Collection,
} as const;

const groups: Record<ThreadKind, ThreadGroup> = {
  quote: "cotizacion", work: "cotizacion", purchase: "compras", purchase_receipt: "compras", expense: "compras",
  sales_remito: "ventas", invoice: "ventas", counter_sale: "ventas", payment: "tesoreria", collection: "tesoreria",
};

/** Con qué nombre quedan en la bitácora (`AuditLog.entity`). */
const auditEntities: Record<ThreadKind, string> = {
  quote: "quotes", work: "works", purchase: "purchases", purchase_receipt: "purchase_receipts", expense: "expenses",
  sales_remito: "sales_remitos", invoice: "invoices", counter_sale: "counter_sales", payment: "payments", collection: "collections",
};

/** Quién puede ver cada uno: los mismos permisos de sus pantallas. */
function readable(session: Session, kind: ThreadKind) {
  switch (kind) {
    case "quote": return canRead(session, "quotes");
    case "work": return canRead(session, "works");
    case "purchase": case "purchase_receipt": return canRead(session, "purchases");
    case "expense": return canRead(session, "expenses");
    case "sales_remito": return canRead(session, "stock") || canRead(session, "invoices");
    case "invoice": case "counter_sale": return canRead(session, "invoices");
    case "payment": return canRead(session, "payments");
    case "collection": return canRead(session, "collections");
  }
}

const str = (value: unknown) => value === undefined || value === null || value === "" ? "" : String(value);
const ids = (value: unknown) => (Array.isArray(value) ? value : value ? [value] : []).map(str).filter(id => Types.ObjectId.isValid(id));
const oid = (id: string) => new Types.ObjectId(id);
const refs = (kind: ThreadKind, values: unknown): Ref[] => ids(values).map(id => ({ kind, id }));
const refsOf = (kind: ThreadKind, rows: Doc[]) => rows.map(row => ({ kind, id: String(row._id) }));
const find = (kind: ThreadKind, filter: Record<string, unknown>) => (models[kind] as typeof Quote).find(filter).select("_id").limit(THREAD_LIMIT).lean<Doc[]>();

/** Los vínculos que escribe cada documento: lo que apunta hacia afuera. Sirve también para comparar el antes y el después de la bitácora. */
function ownLinks(kind: ThreadKind, doc: Record<string, unknown>): Ref[] {
  const allocations = (key: string) => (Array.isArray(doc.allocations) ? doc.allocations as Array<Record<string, unknown>> : []).map(row => row[key]);
  switch (kind) {
    case "quote": return refs("work", doc.workId);
    case "work": return refs("quote", doc.quoteId);
    case "purchase": return [...refs("purchase", [doc.requestId, doc.orderId, doc.correctsId]), ...refs("quote", doc.quoteId), ...refs("work", doc.workId)];
    case "purchase_receipt": return [...refs("purchase", doc.purchaseId), ...refs("quote", doc.quoteId), ...refs("work", doc.workId)];
    case "expense": return [...refs("purchase", doc.purchaseId), ...refs("purchase_receipt", [...ids(doc.purchaseReceiptIds), ...ids(doc.billedPurchaseReceipts)]), ...refs("expense", doc.associatedExpenseId), ...refs("quote", doc.quoteId), ...refs("work", doc.workId)];
    case "sales_remito": return [...refs("invoice", doc.invoiceIds), ...refs("sales_remito", doc.returnsId), ...refs("quote", doc.quoteId), ...refs("work", doc.workId)];
    case "invoice": return [...refs("sales_remito", [...ids(doc.remitoIds), ...(Array.isArray(doc.remitoLines) ? (doc.remitoLines as Array<Record<string, unknown>>).map(line => line.remitoId) : [])]), ...refs("invoice", [doc.replacesId, doc.replacedById, doc.associatedInvoiceId]), ...refs("quote", doc.quoteId), ...refs("work", doc.workId)];
    case "counter_sale": return [...refs("sales_remito", doc.remitoId), ...refs("invoice", doc.invoiceId), ...refs("collection", doc.collectionId)];
    case "payment": return [...refs("expense", [doc.expenseId, ...allocations("expenseId")]), ...refs("purchase", [doc.purchaseId, doc.requestId]), ...refs("work", doc.workId)];
    case "collection": return refs("invoice", [doc.invoiceId, ...allocations("invoiceId")]);
  }
}

/** Lo que apunta a este documento desde otros. */
async function incomingLinks(kind: ThreadKind, doc: Doc): Promise<Ref[]> {
  const id = doc._id;
  const many = async (pairs: Array<[ThreadKind, Record<string, unknown>]>) => (await Promise.all(pairs.map(async ([target, filter]) => refsOf(target, await find(target, filter))))).flat();
  switch (kind) {
    case "quote": return many([["work", { quoteId: id }], ["purchase", { quoteId: id }], ["purchase_receipt", { quoteId: id }], ["expense", { quoteId: id }], ["sales_remito", { quoteId: id }], ["invoice", { quoteId: id }]]);
    case "work": return many([["quote", { workId: id }], ["purchase", { workId: id }], ["purchase_receipt", { workId: id }], ["expense", { workId: id }], ["sales_remito", { workId: id }], ["invoice", { workId: id }]]);
    case "purchase": {
      const found = await many([["purchase", { $or: [{ requestId: id }, { orderId: id }, { correctsId: id }] }], ["purchase_receipt", { purchaseId: id }], ["expense", { purchaseId: id }], ["payment", { $or: [{ purchaseId: id }, { requestId: id }] }]]);
      return [...found, ...await legacyCorrections(doc)];
    }
    case "purchase_receipt": return many([["expense", { $or: [{ purchaseReceiptIds: id }, { billedPurchaseReceipts: id }] }]]);
    case "expense": return many([["expense", { associatedExpenseId: id }], ["payment", { $or: [{ expenseId: id }, { "allocations.expenseId": id }] }]]);
    case "sales_remito": return many([["invoice", { $or: [{ remitoIds: id }, { "remitoLines.remitoId": id }] }], ["sales_remito", { returnsId: id }], ["counter_sale", { remitoId: id }]]);
    case "invoice": return many([["sales_remito", { invoiceIds: id }], ["invoice", { $or: [{ associatedInvoiceId: id }, { replacesId: id }, { replacedById: id }] }], ["collection", { $or: [{ invoiceId: id }, { "allocations.invoiceId": id }] }], ["counter_sale", { invoiceId: id }]]);
    case "counter_sale": return [];
    case "payment": return [];
    case "collection": return many([["counter_sale", { collectionId: id }]]);
  }
}

/** Las correcciones de antes de `correctsId` sólo dejaron el texto en el historial: "Corrige la SC-23" y "Reemplazada por la SC-31". */
async function legacyCorrections(doc: Doc): Promise<Ref[]> {
  const numbers = (Array.isArray(doc.history) ? doc.history as Array<{ action?: string }> : [])
    .map(entry => /^(?:Corrige la|Reemplazada por la) ((?:SC|OC)-\d+)/.exec(String(entry.action || ""))?.[1]).filter((value): value is string => Boolean(value));
  const number = str(doc.number).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Y al revés: la compra que dice que corrige a esta.
  const filter = number ? [{ "history.action": new RegExp(`^Corrige la ${number}\\b`) }] : [];
  if (!numbers.length && !filter.length) return [];
  return refsOf("purchase", await Purchase.find({ $or: [{ number: { $in: numbers } }, ...filter] }).select("_id").lean<Doc[]>());
}

/** Los documentos de la cotización y la obra no se abren si no son el punto de partida: si no, una factura traería la obra entera. */
const hubs = new Set<ThreadKind>(["quote", "work"]);

function iso(value: unknown) {
  const date = value instanceof Date ? value : value ? new Date(String(value)) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

function describe(kind: ThreadKind, doc: Doc): Omit<ThreadNode, "kind" | "id" | "group" | "root" | "events" | "userName"> & { userName?: string } {
  const id = String(doc._id);
  const created = iso(doc.createdAt);
  const base = { createdAt: created, userName: str(doc.userName) || undefined };
  const search = (path: string, value: string) => `/app/${path}?buscar=${encodeURIComponent(value)}`;
  switch (kind) {
    case "quote": return { ...base, type: "Cotización", number: str(doc.number), title: str(doc.title), date: created, amountCents: Number(doc.amountCents || 0), status: str(doc.status), voided: ["rechazada", "vencida"].includes(str(doc.status)), href: `/app/quotes/${id}` };
    case "work": return { ...base, type: "Obra", number: str(doc.code), title: str(doc.name), date: iso(doc.startDate) || created, status: str(doc.status), voided: false, href: `/app/works/${id}` };
    case "purchase": {
      const order = doc.stage !== "solicitud";
      return { ...base, type: order ? "Orden de compra" : "Solicitud de compra", number: str(doc.number), title: str(doc.description),
        date: order ? iso((doc.approval as Record<string, unknown> | undefined)?.at) || created : iso(doc.requestedDate) || created,
        amountCents: Number(doc.amountCents || 0), status: purchaseStatusText(doc), voided: ["anulada", "cancelada", "rechazada"].includes(str(doc.status)), href: `/app/purchases?ver=${id}` };
    }
    case "purchase_receipt": return { ...base, type: "Remito de compra", number: str(doc.number), title: str(doc.supplierRemito) ? `Remito del proveedor ${str(doc.supplierRemito)}` : undefined, date: iso(doc.date) || created, status: doc.cancellation ? "Anulado" : doc.status === "observada" ? "Observado" : "Conforme", voided: Boolean(doc.cancellation), href: search("remitos-compra", str(doc.number)) };
    case "expense": return { ...base, type: str(doc.voucherType) ? "Factura de compra" : "Gasto", number: invoiceLabel(doc) || str(doc.number), title: str(doc.description), date: iso(doc.issueDate) || created, amountCents: (isCreditNote(doc.voucherType) ? -1 : 1) * Number(doc.amountCents || 0), status: str(doc.status), voided: doc.status === "anulado", href: search("expenses", str(doc.number)) };
    case "sales_remito": return { ...base, type: doc.kind === "devolucion" ? "Devolución" : "Remito de venta", number: str(doc.number), title: str(doc.receiverName) ? `Recibió ${str(doc.receiverName)}` : undefined, date: iso(doc.date) || created, amountCents: Number(doc.totalCents || 0) || undefined, status: str(doc.status), voided: doc.status === "anulado", href: search("remitos", str(doc.number)) };
    case "invoice": return { ...base, type: "Factura de venta", number: invoiceLabel(doc), title: str(doc.description) || undefined, date: iso(doc.issueDate) || created, amountCents: (isCreditNote(doc.voucherType) ? -1 : 1) * Number(doc.amountCents || 0), status: str(doc.status), voided: ["anulada", "sustituida"].includes(str(doc.status)), href: search("invoices", str(doc.number).replace(/^X-/, "")) };
    case "counter_sale": return { ...base, type: "Venta de mostrador", number: str(doc.number), title: str(doc.clientName) || str(doc.buyerName) || undefined, date: iso(doc.date) || created, amountCents: Number(doc.amountCents || 0), status: doc.status === "sin_cobro" ? "Sin cobrar" : "Cobrada", voided: false, href: "/app/mostrador" };
    case "payment": return { ...base, type: "Orden de pago", number: str(doc.number), date: iso(doc.date) || created, amountCents: Number(doc.amountCents || 0) + Number(doc.onAccountCents || 0), status: str(doc.status), voided: doc.status === "anulada", href: search("payments", str(doc.number)) };
    case "collection": return { ...base, type: "Recibo", number: str(doc.number), date: iso(doc.date) || created, amountCents: Number(doc.amountCents || 0) + Number(doc.onAccountCents || 0), status: str(doc.status) || undefined, voided: doc.status === "anulado" || doc.status === "anulada", href: search("collections", str(doc.number)) };
  }
}

/** Un documento con su tipo, como lo escribe la gente: "OC-29", "Factura A 0004-00001520". */
function shortLabel(node: Pick<ThreadNode, "type" | "number">) {
  return /^(SC|OC|OP|RC|R|VM|ENV)-/.test(node.number) || node.number.startsWith(node.type.split(" ")[0]) ? node.number : `${node.type} ${node.number}`.trim();
}

/**
 * El hilo de un documento: todos los documentos atados a él, de los cuatro
 * conjuntos, ordenados por fecha. Sólo se muestran los que la persona puede
 * leer; de los demás se cuenta cuántos hay por conjunto, sin datos, y no se
 * sigue de largo por ellos.
 */
export async function documentThread(kind: ThreadKind, id: string, session: Session): Promise<DocumentThread> {
  if (!THREAD_KINDS.includes(kind)) throw new HttpError("Documento desconocido", 404);
  if (!Types.ObjectId.isValid(id)) throw new HttpError("ID inválido");
  if (!readable(session, kind)) throw new HttpError("No tenés permiso para ver este documento", 403);
  const start = await (models[kind] as typeof Quote).findById(id).lean<Doc>();
  if (!start) throw new HttpError("Documento no encontrado", 404);

  const docs = new Map<string, { ref: Ref; doc: Doc }>();
  const hidden = new Map<string, ThreadKind>();
  const key = (ref: Ref) => `${ref.kind}:${ref.id}`;
  const queue: Array<{ ref: Ref; doc?: Doc }> = [{ ref: { kind, id }, doc: start }];
  const seen = new Set([key({ kind, id })]);
  let truncated = false;

  while (queue.length) {
    const { ref, doc: known } = queue.shift()!;
    if (docs.size >= THREAD_LIMIT) { truncated = true; break; }
    if (!readable(session, ref.kind)) { hidden.set(key(ref), ref.kind); continue; }
    const doc = known || await (models[ref.kind] as typeof Quote).findById(ref.id).lean<Doc>();
    if (!doc) continue;
    docs.set(key(ref), { ref, doc });
    const root = ref.kind === kind && ref.id === id;
    // La cotización y su obra se muestran juntas, pero desde un comprobante no se abre todo lo demás de la obra.
    const next = hubs.has(ref.kind) && !root ? ownLinks(ref.kind, doc) : [...ownLinks(ref.kind, doc), ...await incomingLinks(ref.kind, doc)];
    for (const link of next) {
      const linkKey = key(link);
      if (seen.has(linkKey)) continue;
      seen.add(linkKey);
      queue.push({ ref: link });
    }
  }
  if (queue.length) truncated = true;

  // Quién cargó cada uno y qué se asoció después: de la bitácora.
  const objectIds = [...docs.values()].map(({ ref }) => oid(ref.id));
  const audits = objectIds.length ? await AuditLog.find({ entityId: { $in: objectIds } }).select("action entity entityId before after userName createdAt").sort({ createdAt: 1 }).limit(2000).lean<Doc[]>() : [];
  const nodes = new Map<string, ThreadNode>();
  for (const [nodeKey, { ref, doc }] of docs) {
    const described = describe(ref.kind, doc);
    nodes.set(nodeKey, { kind: ref.kind, id: ref.id, group: groups[ref.kind], root: ref.kind === kind && ref.id === id, events: [], ...described });
  }
  for (const entry of audits) {
    const target = [...docs.values()].find(({ ref, doc }) => String(doc._id) === String(entry.entityId) && auditEntities[ref.kind] === entry.entity);
    if (!target) continue;
    const node = nodes.get(key(target.ref))!;
    const at = iso(entry.createdAt);
    if (entry.action === "create") { node.userName ||= str(entry.userName) || undefined; continue; }
    // Un vínculo que aparece en el después y no estaba en el antes: se asoció en ese momento.
    const before = new Set(ownLinks(target.ref.kind, (entry.before || {}) as Record<string, unknown>).map(key));
    for (const link of ownLinks(target.ref.kind, (entry.after || {}) as Record<string, unknown>)) {
      const other = nodes.get(key(link));
      if (!other || before.has(key(link)) || !entry.before) continue;
      node.events.push({ at, userName: str(entry.userName) || undefined, label: `Asociado a ${shortLabel(other)}` });
    }
  }
  // Lo que deja escrito cada compra: corregida, reemplazada, cambio de proveedor.
  for (const { ref, doc } of docs.values()) {
    if (ref.kind !== "purchase" || !Array.isArray(doc.history)) continue;
    const node = nodes.get(key(ref))!;
    for (const entry of doc.history as Array<{ action?: string; at?: Date; userName?: string; note?: string }>) {
      if (/^(Corrige|Reemplazada|Proveedor cambiado|Anulada)/.test(String(entry.action || ""))) {
        node.events.push({ at: iso(entry.at), userName: entry.userName, label: [entry.action, entry.note].filter(Boolean).join(": ") });
      }
    }
  }

  const sorted = [...nodes.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || "").localeCompare(b.createdAt || ""));
  const live = sorted.filter(node => !node.voided);
  const sum = (predicate: (node: ThreadNode) => boolean) => live.filter(predicate).reduce((total, node) => total + Number(node.amountCents || 0), 0);
  const hiddenByGroup: Partial<Record<ThreadGroup, number>> = {};
  for (const hiddenKind of hidden.values()) hiddenByGroup[groups[hiddenKind]] = (hiddenByGroup[groups[hiddenKind]] || 0) + 1;
  const paid = live.filter(node => node.kind === "payment" && (!node.status || node.status === "pagada"));
  return {
    nodes: sorted, hidden: hiddenByGroup, truncated,
    totals: {
      quotedCents: sum(node => node.kind === "quote"),
      orderedCents: sum(node => node.kind === "purchase" && node.type === "Orden de compra"),
      billedPurchasesCents: sum(node => node.kind === "expense"),
      paidCents: paid.reduce((total, node) => total + Number(node.amountCents || 0), 0),
      billedSalesCents: sum(node => node.kind === "invoice"),
      collectedCents: sum(node => node.kind === "collection"),
    },
  };
}
