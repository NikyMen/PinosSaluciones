"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Field } from "@/lib/entity-config";
import { date, money } from "@/lib/format";
import { FormField, type FieldProps } from "@/components/record-form";
import { PURCHASE_PERCEPTIONS, pctLabel, purchaseLineNetCents, purchaseTotals, storedPurchaseTaxes, VOUCHER_TAX_CENTS_KEYS, voucherTaxFields } from "@/lib/purchase-taxes";
import { baseInvoiceType, isCreditNote, isNote } from "@/lib/invoice-labels";
import { MoneyInput } from "@/components/fields";
import { fetchAllRecords } from "@/lib/fetch-all-records";
import { ProjectCategoryField } from "@/components/work-category-settings";
import { todayIso } from "@/lib/format";
import { PURCHASE_VAT_RATES } from "@/lib/purchase-taxes";

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
function TaxPreview({ netCents, vatRows, rates, amounts, totalLabel, byAmount = false }: {
  netCents: number; vatRows: Array<{ pct: number; vatCents: number }>; rates: Rates;
  amounts: { perceptionVatCents: number; perceptionIibbCents: number; perceptionIibbProvCents: number; internalTaxCents: number; amountCents: number }; totalLabel: string;
  /** En la factura del proveedor las percepciones van por importe: no se muestra el porcentaje. */ byAmount?: boolean;
}) {
  const shows = (percent: number, cents: number) => byAmount ? cents > 0 : percent > 0;
  return <dl className="purchase-taxes-preview" aria-live="polite">
    <div><dt>Neto (sin IVA)</dt><dd>{money(netCents)}</dd></div>
    {vatRows.map(row => <div key={row.pct}><dt>IVA {pctLabel(row.pct)}</dt><dd>{money(row.vatCents)}</dd></div>)}
    {PURCHASE_PERCEPTIONS.map(({ key, label }) => shows(rates[`${key}Pct`], amounts[`${key}Cents`]) && <div key={key}><dt>{label}{byAmount ? "" : ` ${pctLabel(rates[`${key}Pct`])}`}</dt><dd>{money(amounts[`${key}Cents`])}</dd></div>)}
    {shows(rates.internalTaxPct, amounts.internalTaxCents) && <div><dt>Impuesto interno{byAmount ? "" : ` ${pctLabel(rates.internalTaxPct)}`}</dt><dd>{money(amounts.internalTaxCents)}</dd></div>}
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
export function PurchaseFields({ fields, fieldProps, editing, works, quotes }: {
  fields: Field[]; fieldProps: (field: Field) => FieldProps; editing: Item | null; works: Item[]; quotes: Item[];
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const stored = editing ? storedPurchaseTaxes(editing) : null;
  const { values, number } = useFormValues(wrap);
  const [stockMode, setStockMode] = useState(editing ? Boolean(editing.stockOnApproval) : true);
  const [catalog, setCatalog] = useState<Item[]>([]);
  type Line = { key: number; stockItemId?: string; code: string; name: string; unit: string; category: string; quantity: number; unitCents: number; discountCents: number; vatPct: number; presentation?: string; minSale?: string };
  const initial = Array.isArray(editing?.items) ? editing.items as Partial<Line>[] : [];
  const nextKey = useRef(initial.length + 1);
  const blank = (key: number): Line => ({ key, code: "", name: "", unit: "unidad", category: "materiales", quantity: 1, unitCents: 0, discountCents: 0, vatPct: 21 });
  const [lines, setLines] = useState<Line[]>(() => initial.length ? initial.map((line, key) => ({ ...blank(key), ...line, key })) : [blank(0)]);
  useEffect(() => { let active = true; fetchAllRecords("stock").then(items => { if (active) setCatalog(items as Item[]); }).catch(() => {}); return () => { active = false; }; }, []);
  const patchLine = (key: number, patch: Partial<Line>) => setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line));
  // El presupuesto del proveedor suele venir con precios finales: con esto se cargan con IVA y se guarda el neto (Jorge, 10/11/2026).
  const [pricesWithVat, setPricesWithVat] = useState(false);
  const toNet = (pesos: number, vatPct: number) => Math.round(pesos * 100 / (pricesWithVat ? 1 + vatPct / 100 : 1));
  const shownPrice = (cents: number, vatPct: number) => Math.round(cents * (pricesWithVat ? 1 + vatPct / 100 : 1)) / 100;
  const itemMode = stockMode || !editing || initial.length > 0;

  const terms = values.paymentTerms || String(editing?.paymentTerms || "contado");
  const shown = fields.filter(field => !field.readOnly && !(field.key === "termDays" && terms !== "plazo") && !(field.key === "cashMethod" && terms !== "contado"));
  const rates = ratesOf(number);
  const totals = purchaseTotals(itemMode ? lines.map(line => ({ totalCents: purchaseLineNetCents(line), vatPct: line.vatPct })) : [{ totalCents: Math.round(number("subtotalCents") * 100) }], { ...rates, vatPct: values.vatPct === undefined ? stored?.vatPct : number("vatPct") });

  const props = (field: Field) => {
    const base = fieldProps(field);
    // Una de antes no tiene el neto ni la alícuota guardados: se muestran los que valen.
    if (stored && field.key === "subtotalCents") return { ...base, value: stored.subtotalCents };
    if (stored && field.key === "vatPct") return { ...base, value: String(stored.vatPct) };
    if (!editing && field.key === "requestedDate") return { ...base, value: todayIso() };
    if (!editing && field.key === "cashMethod") return { ...base, value: "transferencia" };
    return base;
  };

  const renderField = (field: Field) => <FormField key={field.key} {...props(field)} />;
  // La forma de pago va a la vista en las dos modalidades: también se paga lo que entra directo a stock.
  // El proveedor y la obra también: la orden de compra no sale sin ellos.
  const basic = ["company", "supplierId", "quoteId", "workId", "deliverTo", "requestedDate", "paymentTerms", "cashMethod", "termDays"];
  const relation = (key: string) => fieldProps(fields.find(field => field.key === key)!).relationValue;
  const work = works.find(item => item._id === relation("workId"));
  const quote = quotes.find(item => item._id === (relation("quoteId") || work?.quoteId));
  const workCategoryId = quote?.workCategoryId || work?.workCategoryId || editing?.workCategoryId;
  const visible = shown.filter(field => !itemMode || !["description", "subtotalCents", "vatPct"].includes(field.key));

  return <div className="form-grid" ref={wrap}>
    <label className="wide"><span>Destino de la compra</span><select value={stockMode ? "stock" : "proveedor"} onChange={event => setStockMode(event.target.value === "stock")}>
      <option value="stock">Cargar a stock después de aprobar</option><option value="proveedor">Compra a proveedor (recepción por remito)</option>
    </select></label>
    <input type="hidden" name="stockOnApproval" value={String(stockMode)} />
    {visible.filter(field => basic.includes(field.key)).map(field => renderField(stockMode && field.key === "deliverTo" ? { ...field, label: "Depósito de destino", options: ["central", "salon"], required: true } : field))}
    {workCategoryId ? <ProjectCategoryField readOnly value={workCategoryId} /> : null}
    {stockMode && <p className="invoice-note wide">La solicitud queda pendiente de aprobación, cualquiera sea el importe. Al aprobarla se genera la orden de compra y los ítems ingresan al depósito elegido.</p>}
    {itemMode && <>
      <input type="hidden" name="items" value={JSON.stringify(lines)} />
      <input type="hidden" name="description" value={lines.map(line => `${line.quantity} × ${line.name}`).join(", ").slice(0, 2000)} />
      <input type="hidden" name="subtotalCents" value={totals.subtotalCents / 100} />
      <input type="hidden" name="vatPct" value={stored?.vatPct ?? 21} />
      <label className="wide checkbox-line"><input type="checkbox" checked={pricesWithVat} onChange={event => setPricesWithVat(event.target.checked)} />
        <span>Los precios ya incluyen IVA<em className="field-hint">Si el presupuesto del proveedor viene con el precio final: se escribe con IVA y se guarda el neto, así el IVA no se suma dos veces</em></span></label>
      <datalist id="purchase-stock-products">{catalog.map(item => <option key={item._id} value={String(item.name)}>{String(item.barcode || item.sku || "")}</option>)}</datalist>
      <div className="purchase-item-list wide">{lines.map((line, index) => <fieldset key={line.key} className="form-grid">
        <legend>Ítem {index + 1}</legend>
        <label className="wide"><span>Producto *</span><input required list="purchase-stock-products" value={line.name} placeholder="Buscá un material o escribí uno nuevo" onChange={event => {
          const name = event.target.value;
          const item = catalog.find(item => String(item.name).toLocaleLowerCase() === name.trim().toLocaleLowerCase() || String(item.barcode || item.sku || "") === name);
          patchLine(line.key, item ? { stockItemId: item._id, name: String(item.name), code: String(item.sku || item.barcode || ""), unit: String(item.unit || "unidad"), category: String(item.category || "materiales"), unitCents: Number(item.avgCostCents || item.lastPriceCents || 0) } : { name, stockItemId: undefined, code: "" });
        }} /></label>
        <label><span>Cantidad *</span><input type="number" min="0.001" step="0.001" required value={line.quantity || ""} onChange={event => patchLine(line.key, { quantity: Number(event.target.value) })} /></label>
        <label><span>Unidad</span><select value={line.unit} disabled={Boolean(line.stockItemId)} onChange={event => patchLine(line.key, { unit: event.target.value })}>{["unidad", "kg", "litro", "metro", "m2", "m3", "bolsa", "balde", "rollo"].map(unit => <option key={unit}>{unit}</option>)}</select></label>
        <label><span>{pricesWithVat ? "Costo unitario con IVA" : "Costo unitario sin IVA"}{pricesWithVat && <em className="field-hint">Neto: {money(line.unitCents)}</em>}</span><MoneyInput name={`item-cost-${line.key}`} defaultValue={shownPrice(line.unitCents, line.vatPct)} key={`${line.key}-${line.stockItemId || "nuevo"}-${pricesWithVat}`} onValueChange={value => patchLine(line.key, { unitCents: toNet(value, line.vatPct) })} /></label>
        <label><span>Descuento / bonificación<em className="field-hint">En pesos, sobre el renglón{pricesWithVat ? ", con IVA" : ""}</em></span><MoneyInput name={`item-discount-${line.key}`} key={`discount-${line.key}-${pricesWithVat}`} defaultValue={shownPrice(line.discountCents || 0, line.vatPct)} onValueChange={value => patchLine(line.key, { discountCents: toNet(value, line.vatPct) })} /></label>
        <label><span>IVA</span><select value={line.vatPct} onChange={event => patchLine(line.key, { vatPct: Number(event.target.value) })}>{PURCHASE_VAT_RATES.map(rate => <option value={rate} key={rate}>{pctLabel(rate)}</option>)}</select></label>
        {!line.stockItemId && <label><span>Rubro</span><select value={line.category} onChange={event => patchLine(line.key, { category: event.target.value })}>{["materiales", "herramientas", "seguridad", "consumibles", "otros"].map(category => <option key={category}>{category}</option>)}</select></label>}
        <div><span>Neto: {money(purchaseLineNetCents(line))}</span>{(line.discountCents || 0) > Math.round(line.quantity * line.unitCents) && <small className="warning-line">El descuento pasa el importe del renglón</small>} <button type="button" className="secondary-btn" disabled={lines.length === 1} onClick={() => setLines(current => current.filter(row => row.key !== line.key))}>Quitar ítem</button></div>
      </fieldset>)}<button type="button" className="secondary-btn" disabled={lines.length >= 200} onClick={() => setLines(current => [...current, blank(nextKey.current++)])}>Agregar ítem</button></div>
    </>}
    {itemMode ? <details className="wide"><summary>Observaciones y otros datos</summary><div className="form-grid">{visible.filter(field => !basic.includes(field.key)).map(renderField)}</div></details>
      : visible.filter(field => !basic.includes(field.key)).map(renderField)}
    <TaxPreview netCents={totals.subtotalCents} vatRows={totals.vatByRate} rates={rates} amounts={totals} totalLabel="Total de la solicitud" />
  </div>;
}

type BillableLine = { name?: string; unit?: string; quantity?: number; unitCents?: number; discountCents?: number };
type Receipt = { _id: string; number?: string; supplierRemito?: string; date?: string; final?: boolean; lines?: BillableLine[] };
type OrderInvoices = { orderId: string; number: string; hasItems: boolean; receipts: Receipt[]; expenses: Item[]; items: BillableLine[] };

/** Lo recibido en un remito, a precio de la OC (sin IVA). */
const receivedCents = (receipt: Receipt) => (receipt.lines || []).reduce((total, line) => total + Math.round(Number(line.quantity || 0) * Number(line.unitCents || 0)), 0);
/** El neto de una factura de compra; la nota de crédito resta. Una de antes, sin neto, por su total. */
const invoicedNetCents = (expense: Item) => (isCreditNote(expense.voucherType) ? -1 : 1) * Number(expense.netCents || expense.amountCents || 0);

/** Los remitos de la OC elegida y sus otras facturas, para elegir qué remitos factura y comparar con lo recibido. */
function useOrderInvoices(purchaseId: string) {
  const [data, setData] = useState<OrderInvoices | null>(null);
  useEffect(() => {
    if (!purchaseId) return;
    const controller = new AbortController();
    fetch(`/api/purchases/${purchaseId}/detail`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then((detail: { order?: Item | null; receipts?: Receipt[]; expenses?: Item[] } | null) => setData(detail?.order ? {
        orderId: String(detail.order._id), number: String(detail.order.number || ""), hasItems: Array.isArray(detail.order.items) && detail.order.items.length > 0,
        receipts: detail.receipts || [], expenses: detail.expenses || [], items: (detail.order.items || []) as BillableLine[],
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
export function ExpenseFields({ fields, fieldProps, editing, draft, orders }: {
  fields: Field[]; fieldProps: (field: Field) => FieldProps; editing: Item | null; draft: Record<string, unknown>; orders: Item[];
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const { values, number } = useFormValues(wrap);
  // Se carga el subtotal (antes del descuento) y el descuento o bonificación en pesos: el neto es la resta.
  const netField = fields.find(field => field.key === "netCents");
  const discountField = fields.find(field => field.key === "discountCents");
  const storedNet = netField ? Number(fieldProps(netField).value || 0) : 0;
  const storedDiscount = discountField ? Number(fieldProps(discountField).value || 0) : 0;
  const manualGross = values.grossNetCents === undefined ? storedNet + storedDiscount : Math.round(number("grossNetCents") * 100);
  const discountCents = values.discountCents === undefined ? storedDiscount : Math.round(number("discountCents") * 100);
  const voucherType = values.voucherType ?? String((editing || draft).voucherType || "");
  const mode = (editing || draft).withRemito;
  const modern = typeof mode === "boolean";
  const withVat = Boolean(voucherType) && baseInvoiceType(voucherType) === "factura_a";
  // Las percepciones y el impuesto interno se cargan por importe, como figuran en la factura (en pesos en el formulario).
  const typed = (key: string) => values[key] === undefined ? Number(editing?.[key] || 0) : Math.round(number(key) * 100);
  // La letra sale del tipo de comprobante: el número es 4 dígitos, guion y 8 (Tesorería, 10/11/2026).
  const letter = voucherType ? voucherType.slice(-1).toUpperCase() : "";
  const originalNumber = String(editing?.number || "");

  const receiptsField = fields.find(field => field.key === "purchaseReceiptIds");
  const initial = receiptsField ? fieldProps(receiptsField).value : undefined;
  const purchaseField = fields.find(field => field.key === "purchaseId")!;
  const supplierField = fields.find(field => field.key === "supplierId")!;
  const purchaseId = fieldProps(purchaseField).relationValue;
  const orderRecord = orders.find(item => item._id === purchaseId) || ((draft.purchaseId || editing?.purchaseId) === purchaseId ? (editing || draft) : undefined);
  const supplierId = String((modern && purchaseId && orderRecord?.supplierId) || fieldProps(supplierField).relationValue || "");
  const order = useOrderInvoices(purchaseId);
  const receiptQuery = mode === true && supplierId ? new URLSearchParams({ supplierId, purchaseId, expenseId: editing?._id || "" }).toString() : "";
  const [pending, setPending] = useState<{ query: string; receipts: Receipt[]; error?: string } | null>(null);
  useEffect(() => {
    if (!receiptQuery) return;
    const controller = new AbortController();
    void fetch(`/api/purchase-receipts?${receiptQuery}`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setPending({ query: receiptQuery, receipts: body.items });
    }).catch(error => {
      if (!controller.signal.aborted) setPending({ query: receiptQuery, receipts: [], error: error.message || "No se pudieron leer los remitos" });
    });
    return () => controller.abort();
  }, [receiptQuery]);
  const others = (order?.expenses || []).filter(expense => String(expense._id) !== String(editing?._id || "") && expense.status !== "anulado");
  // Lo elegido a mano; sin tocar, lo que ya tenía o, en una factura nueva, los remitos que no están en otra factura.
  const [picked, setPicked] = useState<{ orderId: string; ids: string[] } | null>(null);
  const billed = new Set(others.flatMap(expense => (expense.purchaseReceiptIds as string[] | undefined) || []).map(String));
  const defaults = Array.isArray(initial) && initial.length ? initial.map(String)
    : editing ? [] : (order?.receipts || []).filter(receipt => !billed.has(String(receipt._id))).map(receipt => String(receipt._id));
  const pickerKey = modern ? receiptQuery : purchaseId;
  const available = modern ? (pending?.query === receiptQuery ? pending.receipts : []) : order?.receipts || [];
  const selected = picked?.orderId === pickerKey ? picked.ids : modern ? (Array.isArray(initial) ? initial.map(String) : []) : defaults;
  const toggle = (id: string) => setPicked({ orderId: pickerKey, ids: selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id] });
  const chosen = available.filter(receipt => selected.includes(String(receipt._id)));
  const storedPrices = (editing?.receiptPrices || []) as Array<{ receiptId: string; line: number; unitCents: number }>;
  const storedOrderPrices = (editing?.orderPrices || []) as number[];
  const [prices, setPrices] = useState<Record<string, number>>({});
  const orderLines = mode === false && purchaseId && (!editing || Array.isArray(editing.orderPrices)) ? order?.items || [] : [];
  const rows = mode === true
    ? chosen.flatMap(receipt => (receipt.lines || []).map((line, index) => ({
      ...line, key: `${receipt._id}:${index}`, receiptId: receipt._id, line: index, ref: receipt.supplierRemito || receipt.number,
      price: storedPrices.find(price => price.receiptId === receipt._id && price.line === index)?.unitCents ?? line.unitCents ?? 0,
    })))
    : orderLines.map((line, index) => ({
      ...line, key: `${purchaseId}:${index}`, receiptId: "", line: index, ref: order?.number,
      price: storedOrderPrices[index] ?? (line.quantity ? Math.round(purchaseLineNetCents({ quantity: line.quantity, unitCents: line.unitCents || 0, discountCents: line.discountCents }) / line.quantity) : 0),
    }));
  const priced = rows.map(row => ({ ...row, unitCents: prices[row.key] ?? row.price }));
  const grossCents = rows.length ? priced.reduce((sum, row) => sum + Math.round(Number(row.quantity || 0) * row.unitCents), 0) : manualGross;
  const net = Math.max(0, grossCents - discountCents);
  const amounts = voucherTaxFields(net, { vatPct: values.vatPct === undefined || values.vatPct === "" ? undefined : number("vatPct") }, withVat,
    Object.fromEntries(VOUCHER_TAX_CENTS_KEYS.map(key => [key, typed(key)])));
  const rates: Rates = { perceptionVatPct: amounts.perceptionVatPct, perceptionIibbPct: amounts.perceptionIibbPct, perceptionIibbProvPct: amounts.perceptionIibbProvPct, internalTaxPct: amounts.internalTaxPct };

  // Lo recibido contra lo facturado: con remitos elegidos, contra ellos; si no, contra todo lo recibido en la OC.
  const received = (chosen.length ? chosen : order?.receipts || []).reduce((total, receipt) => total + receivedCents(receipt), 0);
  const invoiced = (chosen.length ? 0 : others.reduce((total, expense) => total + invoicedNetCents(expense), 0)) + (isCreditNote(voucherType) ? -net : net);
  const warning = !order || net <= 0 || isCreditNote(voucherType) ? ""
    : !order.receipts.length ? `La orden ${order.number} todavía no tiene remitos: se factura algo que no llegó.`
      : order.hasItems && invoiced > received + 100 ? (chosen.length
        ? `El neto (${money(net)}) pasa lo recibido en los remitos elegidos (${money(received)}, a precio de la OC).`
        : `Con esta factura, la orden ${order.number} tendría facturado ${money(invoiced)} netos y recibido ${money(received)}.`)
        : "";

  // Al cargar no se elige el estado (sale de las órdenes de pago) y "Factura que corrige" es sólo de las notas.
  // En una factura tampoco van la obra ni la categoría: lo comprado entra al depósito y la obra la pone
  // el remito con que sale (Administración, 12/11/2026). Un gasto sin comprobante las sigue pidiendo.
  const shown = fields.filter(field => field !== receiptsField && !(field.key === "status" && !editing) && !(field.key === "associatedExpenseId" && !isNote(voucherType))
    && !(voucherType && (field.key === "workId" || field.key === "category")));

  return <div className="form-grid" ref={wrap}>
    {modern && <input type="hidden" name="withRemito" value={String(mode)} />}
    {(orderRecord?.workCategoryId || editing?.workCategoryId) ? <ProjectCategoryField readOnly value={orderRecord?.workCategoryId || editing?.workCategoryId} /> : null}
    {shown.map((field, index) => modern && purchaseId && (["supplierId", "company", "workId", "quoteId"].includes(field.key) || (field.key === "purchaseId" && Boolean(editing?.purchaseId || draft.purchaseId)))
      ? <label className="readonly-field" key={field.key}><span>{field.label}</span><output>{
        field.relation ? fieldProps(field).relationOptions.find(option => option.value === String(orderRecord?.[field.key] ?? (field.key === "purchaseId" ? purchaseId : "")))?.label || "—"
          : field.optionLabels?.[String(orderRecord?.[field.key])] || "—"
      }</output>
        {/* La OC fija (abierta desde "Cargar factura" de la orden) igual viaja: de ella salen el proveedor, la empresa y la obra. */}
        {field === purchaseField && <input type="hidden" name="purchaseId" value={purchaseId} />}</label>
      : modern && field === purchaseField
        ? <FormField key={field.key} {...fieldProps(field)} relationOptions={fieldProps(field).relationOptions.filter(option => orders.some(item => item._id === option.value && item.stage !== "solicitud" && !["anulada", "cancelada"].includes(String(item.status))))} onCreateRelation={undefined} />
      : modern && field.key === "receiptRef" && mode === true
        ? null
      : field === netField
      ? <label key={field.key}><span>Subtotal sin IVA<em className="field-hint">Antes del descuento. Si lo cargás, el IVA, las percepciones y el total salen solos</em></span>
        {rows.length ? <output>{money(grossCents)}</output> : <MoneyInput name="grossNetCents" defaultValue={(storedNet + storedDiscount) / 100} />}
        <input type="hidden" name="netCents" value={grossCents > 0 ? net / 100 : ""} />
        {grossCents > 0 && <small className={discountCents > grossCents ? "warning-line" : "muted-line"}>{discountCents > grossCents ? "El descuento pasa el subtotal" : `Neto después del descuento: ${money(net)}`}</small>}</label>
      : field.key === "number" && letter
        ? <label key={field.key}><span>Número *<em className="field-hint">4 números, guion y 8 números</em></span>
          <div className="voucher-number"><b aria-label={`Letra ${letter}`}>{letter}</b>
            <input name="number" required inputMode="numeric" autoComplete="off" maxLength={13} placeholder="0001-00012345" defaultValue={originalNumber}
              onInput={event => {
                const input = event.currentTarget;
                const digits = input.value.replace(/\D/g, "").slice(0, 12);
                input.value = digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
                // Una factura de antes con otro formato se guarda igual mientras no se toque el número.
                input.setCustomValidity(input.value === originalNumber || digits.length === 12 ? "" : "Tienen que ser 12 números: 4 antes del guion y 8 después");
              }} /></div></label>
        : <FormField key={field.key} {...fieldProps(field)} autoFocus={index === 0} />)}
    {receiptQuery && pending?.query === receiptQuery && pending.error && <p className="form-error" role="alert">{pending.error}</p>}
    {receiptsField && (mode === true && pending?.query === receiptQuery || !modern && order) && <input type="hidden" name="purchaseReceiptIds" value={selected.join(",")} />}
    {(mode === true || !modern && order) && <fieldset className="receipt-picker">
      <legend>Remitos que factura</legend>
      {!supplierId && modern ? <small>Elegí el proveedor para ver sus remitos.</small>
        : modern && pending?.query !== receiptQuery ? <small>Cargando…</small>
        : !available.length ? <small>No hay remitos pendientes.</small>
        : available.map(receipt => <label key={receipt._id}>
          <input type="checkbox" checked={selected.includes(String(receipt._id))} onChange={() => toggle(String(receipt._id))} />
          <b>{receipt.supplierRemito || receipt.number}</b>
          <small>{[receipt.date && date(receipt.date), receipt.final && "final", billed.has(String(receipt._id)) && "ya está en otra factura"].filter(Boolean).join(" · ")}</small>
        </label>)}
    </fieldset>}
    {priced.length > 0 && <fieldset className="receipt-picker">
      <legend>Precios sin IVA</legend>
      {priced.map(row => <label className="receipt-price" key={row.key}>
        <span>{row.name}<small className="tracking-sub">{row.quantity} {row.unit} · {row.ref}</small></span>
        <MoneyInput name={`price-${row.key}`} defaultValue={row.unitCents / 100} onValueChange={value => setPrices(current => ({ ...current, [row.key]: Math.round(value * 100) }))} />
      </label>)}
    </fieldset>}
    {mode === true && pending?.query === receiptQuery && <input type="hidden" name="receiptPrices" value={JSON.stringify(priced.map(({ receiptId, line, unitCents }) => ({ receiptId, line, unitCents })))} />}
    {mode === false && purchaseId && (!editing || Array.isArray(editing.orderPrices)) && order && <input type="hidden" name="orderPrices" value={JSON.stringify(priced.map(row => row.unitCents))} />}
    {warning && <p className="notice warning invoice-warning" role="status">{warning}</p>}
    {net > 0 && <TaxPreview netCents={net} vatRows={withVat ? [{ pct: amounts.vatPct, vatCents: amounts.vatCents }] : []} rates={rates} amounts={amounts} byAmount totalLabel="Total del comprobante (se guarda este)" />}
  </div>;
}
