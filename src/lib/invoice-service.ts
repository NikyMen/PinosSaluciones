import { Work } from "./models";

export { invoiceLabel, voucherLabels, VOUCHER_TYPES } from "./invoice-labels";

/**
 * Antes de guardar una factura (alta o cambio):
 * - con el neto cargado, el IVA y el total salen de ahí;
 * - la cotización y la obra se completan una con la otra;
 * - el estado sale de lo cobrado (lo mueven los recibos), salvo que se la anule.
 * `data` es lo que se va a guardar y se completa en el lugar; `before`, la factura como estaba.
 */
export async function prepareInvoice(data: Record<string, unknown>, before: Record<string, unknown> = {}) {
  const merged = { ...before, ...data };
  const net = Number(merged.netCents || 0);
  if (("netCents" in data || "vatPct" in data) && net > 0) {
    const pct = Number(merged.vatPct ?? 21);
    const vat = Math.round(net * pct / 100);
    Object.assign(data, { vatPct: pct, vatCents: vat, amountCents: net + vat });
  }

  if ("quoteId" in data || "workId" in data) {
    if (merged.workId && !merged.quoteId) {
      const work = await Work.findById(merged.workId).select("quoteId").lean() as { quoteId?: unknown } | null;
      if (work?.quoteId) data.quoteId = work.quoteId;
    } else if (merged.quoteId && !merged.workId) {
      const work = await Work.findOne({ quoteId: merged.quoteId }).select("_id").lean() as { _id: unknown } | null;
      if (work) data.workId = work._id;
    }
  }

  const status = data.status ?? before.status;
  if (status !== "anulada") {
    const amount = Number(data.amountCents ?? before.amountCents ?? 0);
    const collected = Number(before.collectedCents ?? data.collectedCents ?? 0);
    data.status = amount > 0 && collected >= amount ? "cobrada" : collected > 0 ? "parcial" : "pendiente";
  }
}
