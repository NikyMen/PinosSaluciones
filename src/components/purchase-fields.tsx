"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Field } from "@/lib/entity-config";
import { date, money } from "@/lib/format";
import { FormField, type FieldProps } from "@/components/record-form";
import { PURCHASE_PERCEPTIONS, pctLabel, purchaseTotals, storedPurchaseTaxes, voucherTaxFields } from "@/lib/purchase-taxes";
import { baseInvoiceType, isCreditNote } from "@/lib/invoice-labels";

type Item = Record<string, unknown> & { _id: string };
type Rates = { perceptionVatPct: number; perceptionIibbPct: number; perceptionIibbProvPct: number; internalTaxPct: number };

/** Los campos del formulario no son controlados: se leen del formulario cada vez que algo cambia. */
function useFormValues(wrap: RefObject<HTMLDivElement | null>) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const node = wrap.current;
    const form = node?.closest("form");
    if (!node || !form) return;
    let timer = 0;
    const read = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setValues(Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, String(value)]))), 0);
    };
    read();
    const events = ["input", "change", "click", "keyup"];
    for (const type of events) node.addEventListener(type, read);
    return () => { window.clearTimeout(timer); for (const type of events) node.removeEventListener(type, read); };
  }, [wrap]);
  const number = (key: string) => { const value = Number(String(values[key] ?? "").replace(",", ".")); return Number.isFinite(value) && value > 0 ? value : 0; };
  return { values, number };
}

const ratesOf = (number: (key: string) => number): Rates => ({ perceptionVatPct: number("perceptionVatPct"), perceptionIibbPct: number("perceptionIibbPct"), perceptionIibbProvPct: number("perceptionIibbProvPct"), internalTaxPct: number("internalTaxPct") });

/** Del neto al total, renglón por renglón. */
function TaxPreview({ netCents, vatRows, rates, amounts, totalLabel }: {
  netCents: number; vatRows: Array<{ pct: number; vatCents: number }>; rates: Rates;
  amounts: { perceptionVatCents: number; perceptionIibbCents: number; perceptionIibbProvCents: number; internalTaxCents: number; amountCents: number }; totalLabel: string;
}) {
  return <dl className="purchase-taxes-preview" aria-live="polite">
    <div><dt>Neto (sin IVA)</dt><dd>{money(netCents)}</dd></div>
    {vatRows.map(row => <div key={row.pct}><dt>IVA {pctLabel(row.pct)}</dt><dd>{money(row.vatCents)}</dd></div>)}
    {PURCHASE_PERCEPTIONS.map(({ key, label }) => rates[`${key}Pct`] > 0 && <div key={key}><dt>{label} {pctLabel(rates[`${key}Pct`])}</dt><dd>{money(amounts[`${key}Cents`])}</dd></div>)}
    {rates.internalTaxPct > 0 && <div><dt>Impuesto interno {pctLabel(rates.internalTaxPct)}</dt><dd>{money(amounts.internalTaxCents)}</dd></div>}
    <div className="total"><dt>{totalLabel}</dt><dd>{money(amounts.amountCents)}</dd></div>
  </dl>;
}

/**
 * El formulario de la solicitud de compra cargada a mano. El total no se
 * escribe: se ve en vivo con el neto, el IVA, las percepciones y el impuesto
 * interno, y lo vuelve a calcular el servidor al guardar. El plazo aparece
 * sólo a plazo y el medio de pago sólo de contado. Una solicitud de antes,
 * que tenía sólo el total con IVA, se abre con el neto que sale de ese total.
 */
export function PurchaseFields({ fields, fieldProps, editing }: { fields: Field[]; fieldProps: (field: Field) => FieldProps; editing: Item | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const stored = editing ? storedPurchaseTaxes(editing) : null;
  const { values, number } = useFormValues(wrap);

  const terms = values.paymentTerms || String(editing?.paymentTerms || "contado");
  const shown = fields.filter(field => !field.readOnly && !(field.key === "termDays" && terms !== "plazo") && !(field.key === "cashMethod" && terms !== "contado"));
  const rates = ratesOf(number);
  const totals = purchaseTotals([{ totalCents: Math.round(number("subtotalCents") * 100) }], { ...rates, vatPct: number("vatPct") || stored?.vatPct });

  const props = (field: Field) => {
    const base = fieldProps(field);
    // Una de antes no tiene el neto ni la alícuota guardados: se muestran los que valen.
    if (stored && field.key === "subtotalCents") return { ...base, value: stored.subtotalCents };
    if (stored && field.key === "vatPct") return { ...base, value: String(stored.vatPct) };
    return base;
  };

  return <div className="form-grid" ref={wrap}>
    {shown.map((field, index) => <FormField key={field.key} {...props(field)} autoFocus={index === 0} />)}
    <TaxPreview netCents={totals.subtotalCents} vatRows={totals.vatByRate} rates={rates} amounts={totals} totalLabel="Total de la solicitud" />
  </div>;
}

type Receipt = { _id: string; number?: string; supplierRemito?: string; date?: string; final?: boolean; lines?: Array<{ quantity?: number; unitCents?: number }> };
type OrderInvoices = { orderId: string; number: string; hasItems: boolean; receipts: Receipt[]; expenses: Item[] };

/** Lo recibido en un remito, a precio de la OC (sin IVA). */
const receivedCents = (receipt: Receipt) => (receipt.lines || []).reduce((total, line) => total + Math.round(Number(line.quantity || 0) * Number(line.unitCents || 0)), 0);
/** El neto de una factura de compra; la nota de crédito resta. Una de antes, sin neto, por su total. */
const invoicedNetCents = (expense: Item) => (isCreditNote(expense.voucherType) ? -1 : 1) * Number(expense.netCents || expense.amountCents || 0);

/** Los remitos de la OC elegida y sus otras facturas, para elegir qué remitos factura y comparar con lo recibido. */
function useOrderInvoices(purchaseId: string) {
  const [data, setData] = useState<OrderInvoices | null>(null);
  useEffect(() => {
    if (!purchaseId) { setData(null); return; }
    const controller = new AbortController();
    fetch(`/api/purchases/${purchaseId}/detail`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then((detail: { order?: Item | null; receipts?: Receipt[]; expenses?: Item[] } | null) => setData(detail?.order ? {
        orderId: String(detail.order._id), number: String(detail.order.number || ""), hasItems: Array.isArray(detail.order.items) && detail.order.items.length > 0,
        receipts: detail.receipts || [], expenses: detail.expenses || [],
      } : null))
      .catch(() => { if (!controller.signal.aborted) setData(null); });
    return () => controller.abort();
  }, [purchaseId]);
  return data?.orderId === purchaseId ? data : null;
}

/**
 * El formulario de la factura de compra. Con el neto cargado, el total sale
 * del neto, el IVA (sólo en la A y sus notas), las percepciones y el impuesto
 * interno, y se ve en vivo; sin neto (un costo interno, una factura de antes)
 * se carga el total. Con la OC elegida se tildan los remitos que factura (una
 * factura nueva arranca con los que todavía no están en otra) y avisa si el
 * neto pasa lo recibido.
 */
export function ExpenseFields({ fields, fieldProps, editing }: { fields: Field[]; fieldProps: (field: Field) => FieldProps; editing: Item | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { values, number } = useFormValues(wrap);
  const net = Math.round(number("netCents") * 100);
  const voucherType = values.voucherType || "";
  const withVat = Boolean(voucherType) && baseInvoiceType(voucherType) === "factura_a";
  const rates = ratesOf(number);
  const amounts = voucherTaxFields(net, { ...rates, vatPct: values.vatPct === undefined || values.vatPct === "" ? undefined : number("vatPct") }, withVat);

  const receiptsField = fields.find(field => field.key === "purchaseReceiptIds");
  const initial = receiptsField ? fieldProps(receiptsField).value : undefined;
  const purchaseId = values.purchaseId ?? String(fieldProps(fields.find(field => field.key === "purchaseId")!).value ?? "");
  const order = useOrderInvoices(purchaseId);
  const others = (order?.expenses || []).filter(expense => String(expense._id) !== String(editing?._id || "") && expense.status !== "anulado");
  // Lo elegido a mano; sin tocar, lo que ya tenía o, en una factura nueva, los remitos que no están en otra factura.
  const [picked, setPicked] = useState<{ orderId: string; ids: string[] } | null>(null);
  const billed = new Set(others.flatMap(expense => (expense.purchaseReceiptIds as string[] | undefined) || []).map(String));
  const defaults = Array.isArray(initial) && initial.length ? initial.map(String)
    : editing ? [] : (order?.receipts || []).filter(receipt => !billed.has(String(receipt._id))).map(receipt => String(receipt._id));
  const selected = picked && picked.orderId === order?.orderId ? picked.ids : defaults;
  const toggle = (id: string) => setPicked({ orderId: order?.orderId || "", ids: selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id] });

  // Lo recibido contra lo facturado: con remitos elegidos, contra ellos; si no, contra todo lo recibido en la OC.
  const chosen = (order?.receipts || []).filter(receipt => selected.includes(String(receipt._id)));
  const received = (chosen.length ? chosen : order?.receipts || []).reduce((total, receipt) => total + receivedCents(receipt), 0);
  const invoiced = (chosen.length ? 0 : others.reduce((total, expense) => total + invoicedNetCents(expense), 0)) + (isCreditNote(voucherType) ? -net : net);
  const warning = !order || net <= 0 || isCreditNote(voucherType) ? ""
    : !order.receipts.length ? `La orden ${order.number} todavía no tiene remitos: se factura algo que no llegó.`
      : order.hasItems && invoiced > received + 100 ? (chosen.length
        ? `El neto (${money(net)}) pasa lo recibido en los remitos elegidos (${money(received)}, a precio de la OC).`
        : `Con esta factura, la orden ${order.number} tendría facturado ${money(invoiced)} netos y recibido ${money(received)}.`)
        : "";

  return <div className="form-grid" ref={wrap}>
    {fields.filter(field => field !== receiptsField).map((field, index) => <FormField key={field.key} {...fieldProps(field)} autoFocus={index === 0} />)}
    {receiptsField && <input type="hidden" name="purchaseReceiptIds" value={order ? selected.join(",") : ""} />}
    {order && <fieldset className="receipt-picker">
      <span>Remitos de la orden {order.number} que factura</span>
      {!order.receipts.length ? <small className="muted">Todavía no tiene remitos cargados.</small>
        : order.receipts.map(receipt => <label key={receipt._id}>
          <input type="checkbox" checked={selected.includes(String(receipt._id))} onChange={() => toggle(String(receipt._id))} />
          <b>{receipt.supplierRemito || receipt.number}</b>
          <small>{[receipt.date && date(receipt.date), receipt.final && "final", order.hasItems && money(receivedCents(receipt)), billed.has(String(receipt._id)) && "ya está en otra factura"].filter(Boolean).join(" · ")}</small>
        </label>)}
    </fieldset>}
    {warning && <p className="notice warning invoice-warning" role="status">{warning}</p>}
    {net > 0 && <TaxPreview netCents={net} vatRows={withVat ? [{ pct: amounts.vatPct, vatCents: amounts.vatCents }] : []} rates={rates} amounts={amounts} totalLabel="Total del comprobante (se guarda este)" />}
  </div>;
}
