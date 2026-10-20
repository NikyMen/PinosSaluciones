"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import { money, qty } from "@/lib/format";
import { DEFAULT_PURCHASE_VAT_PCT, PURCHASE_PERCEPTIONS, PURCHASE_VAT_RATES, lineVatPct, pctLabel, purchaseTotals } from "@/lib/purchase-taxes";
import { purchaseCart, usePurchaseCart, type CartLine } from "@/lib/purchase-cart";
import { downloadPurchaseOrderPdf, type PurchaseOrderPdfData } from "@/lib/purchase-order-pdf";
import { DateInput, SearchSelect, type Option } from "@/components/fields";
import { COMPANIES, COMPANY_KEYS } from "@/lib/companies";
import { DELIVERY_OPTIONS } from "@/lib/warehouses";
import { fetchAllRecords } from "@/lib/fetch-all-records";
import { PURCHASE_APPROVAL_LIMIT_CENTS } from "@/lib/constants";

/*
 * El pedido de compra: lo que se fue agregando desde el buscador, separado por
 * proveedor, porque a cada proveedor se le manda su propia orden. Cerrar el
 * pedido emite la solicitud de compra (SC-n) y descarga su PDF. Por debajo de
 * $500.000 queda autorizada y nace la orden de compra; desde ahí espera la
 * autorización. Cada renglón lleva su IVA (por defecto, el de la solicitud) y
 * sobre el neto van las percepciones y el impuesto interno: el total no se
 * escribe, sale de la cuenta.
 */

type Closed = { number: string; supplierName: string; totalCents: number; status?: string; pdf: PurchaseOrderPdfData; pdfFailed: boolean };

/** El botón "Pedido" con cuántos productos tiene, y la ventana del pedido. */
export function PurchaseCart() {
  const lines = usePurchaseCart();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={lines.length ? "secondary-btn cart-btn filled" : "secondary-btn cart-btn"} onClick={() => setOpen(true)}>
      <ShoppingCart size={17} /> Pedido {lines.length > 0 && <span className="cart-count">{lines.length}</span>}
    </button>
    {open && <PurchaseCartModal onClose={() => setOpen(false)} />}
  </>;
}

function PurchaseCartModal({ onClose }: { onClose: () => void }) {
  const lines = usePurchaseCart();
  const [works, setWorks] = useState<Option[]>([]);
  const [closed, setClosed] = useState<Closed[]>([]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previous; };
  }, [onClose]);

  // Las obras, para decir a cuál va el material. Quien no ve obras pide sin obra.
  useEffect(() => {
    fetchAllRecords<{ _id: string; code?: string; name?: string; status?: string }>("works")
      .then(items => ({ items }))
      .then((result: { items?: Array<{ _id: string; code?: string; name?: string; status?: string }> }) => setWorks((result.items || [])
        .filter(work => work.status !== "terminada" && work.status !== "cancelada")
        .map(work => ({ value: work._id, label: `${work.code || ""} · ${work.name || ""}`.trim() }))))
      .catch(() => setWorks([]));
  }, []);

  const groups = useMemo(() => {
    const bySupplier = new Map<string, CartLine[]>();
    for (const line of lines) bySupplier.set(line.supplierId, [...(bySupplier.get(line.supplierId) || []), line]);
    return [...bySupplier.values()];
  }, [lines]);

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal cart-modal" role="dialog" aria-modal="true" aria-labelledby="cart-modal-title">
      <header>
        <div className="modal-title-wrap"><span className="modal-heading-icon"><ShoppingCart /></span><div>
          <p className="eyebrow">PEDIDO DE COMPRA</p>
          <h2 id="cart-modal-title">Tu pedido</h2>
          <small>Una solicitud de compra por proveedor. Al emitirla se confirman los precios con la lista vigente.</small>
        </div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button>
      </header>
      <div className="modal-form-body cart-body">
        {closed.map(order => <div className="notice success cart-closed" key={order.number}>
          <CheckCircle2 size={18} />
          <span><b>Solicitud {order.number} emitida</b> · {order.supplierName} · {money(order.totalCents)} con impuestos · {order.status === "pendiente_autorizacion" ? "espera la autorización de Gerencia o Presidencia" : "autorizada: ya tiene su orden de compra"}.{" "}
            {order.pdfFailed ? "No se pudo generar el PDF: bajalo de nuevo." : "El PDF ya se descargó."}{" "}
            <Link href="/app/purchases">Ver en Solicitudes y órdenes</Link></span>
          <button type="button" className="secondary-btn" onClick={() => { void downloadPurchaseOrderPdf(order.pdf); }}><Download size={15} /> PDF</button>
        </div>)}
        {!groups.length && <div className="empty-state compact"><ShoppingCart size={26} /><p>{closed.length ? "No quedan productos en el pedido." : "Todavía no agregaste productos. Usá el botón “Agregar” de cada producto en el buscador de precios."}</p></div>}
        {groups.map(group => <SupplierOrder key={group[0].supplierId} lines={group} works={works}
          onClosed={order => setClosed(current => [order, ...current])} />)}
      </div>
      <footer><span>El pedido queda guardado en este navegador hasta que emitas la solicitud.</span><button type="button" className="secondary-btn" onClick={onClose}>Seguir buscando</button></footer>
    </section>
  </div>;
}

/** Una cantidad que se puede tipear con coma ("1,5") o mover con los botones. */
function QuantityInput({ line }: { line: CartLine }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = (value: number) => qty(value, 3).replace(/\./g, "");
  return <div className="cart-qty">
    <button type="button" aria-label="Uno menos" disabled={line.quantity <= 1} onClick={() => purchaseCart.setQuantity(line.itemId, Math.max(1, line.quantity - 1))}><Minus size={14} /></button>
    <input inputMode="decimal" aria-label={`Cantidad de ${line.name}`} value={draft ?? text(line.quantity)}
      onFocus={() => setDraft(text(line.quantity))}
      onChange={event => {
        const typed = event.target.value.replace(/[^\d,.]/g, "");
        setDraft(typed);
        const value = Number(typed.replace(",", "."));
        if (value > 0) purchaseCart.setQuantity(line.itemId, value);
      }}
      onBlur={() => setDraft(null)} />
    <button type="button" aria-label="Uno más" onClick={() => purchaseCart.setQuantity(line.itemId, line.quantity + 1)}><Plus size={14} /></button>
  </div>;
}

/** Un porcentaje que se tipea con coma ("1,5"). Vacío es cero. */
function PctInput({ id, label, hint, value, onChange }: { id: string; label: string; hint?: string; value: string; onChange: (value: string) => void }) {
  return <label htmlFor={id}><span>{label}{hint && <em className="field-hint">{hint}</em>}</span>
    <span className="pct-input"><input id={id} inputMode="decimal" value={value} placeholder="0" onChange={event => onChange(event.target.value.replace(/[^\d,.]/g, ""))} /><span>%</span></span></label>;
}

const pctNumber = (value: string) => { const number = Number(value.replace(",", ".")); return Number.isFinite(number) && number > 0 ? number : 0; };

function SupplierOrder({ lines, works, onClosed }: { lines: CartLine[]; works: Option[]; onClosed: (order: Closed) => void }) {
  const [workId, setWorkId] = useState("");
  const [deliverTo, setDeliverTo] = useState("central");
  const [expectedDate, setExpectedDate] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [company, setCompany] = useState("tvp");
  const [notes, setNotes] = useState("");
  // La condición de compra: va en la solicitud y Tesorería la usa para el vencimiento de la orden de pago.
  const [paymentTerms, setPaymentTerms] = useState("contado");
  const [termDays, setTermDays] = useState("");
  const [cashMethod, setCashMethod] = useState("");
  const [requiresAdvance, setRequiresAdvance] = useState(false);
  // Los impuestos: el IVA de la solicitud (los renglones pueden tener otro) y, sobre el neto, las percepciones y el impuesto interno.
  const [vatPct, setVatPct] = useState<number>(DEFAULT_PURCHASE_VAT_PCT);
  const [rates, setRates] = useState({ perceptionVatPct: "", perceptionIibbPct: "", perceptionIibbProvPct: "", internalTaxPct: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { supplierId, supplierName, discountPct } = lines[0];
  const taxRates = { vatPct, perceptionVatPct: pctNumber(rates.perceptionVatPct), perceptionIibbPct: pctNumber(rates.perceptionIibbPct), perceptionIibbProvPct: pctNumber(rates.perceptionIibbProvPct), internalTaxPct: pctNumber(rates.internalTaxPct) };
  const totals = purchaseTotals(lines.map(line => ({ totalCents: Math.round(line.ownCents * line.quantity), vatPct: line.vatPct })), taxRates);
  const setRate = (key: keyof typeof rates) => (value: string) => setRates(current => ({ ...current, [key]: value }));

  async function close() {
    if (!orderDate) return setError("Poné la fecha de la solicitud");
    if (paymentTerms === "plazo" && !(Number(termDays) > 0)) return setError("Poné a cuántos días es el plazo");
    if (paymentTerms === "contado" && !cashMethod) return setError("Es de contado: elegí si se paga en efectivo o por transferencia");
    if (Object.values(taxRates).some(value => value > 100)) return setError("Un porcentaje no puede pasar el 100 %");
    if (deliverTo === "obra" && !workId) return setError("Elegí a qué obra se entrega");
    setBusy(true); setError("");
    const response = await fetch("/api/purchases/orders", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        supplierId, items: lines.map(line => ({ itemId: line.itemId, quantity: line.quantity, vatPct: lineVatPct(line, vatPct) })), company, workId, requestedDate: orderDate, expectedDate, deliverTo, notes,
        paymentTerms, termDays: paymentTerms === "plazo" ? Number(termDays) : undefined, cashMethod: paymentTerms === "contado" ? cashMethod : undefined, requiresAdvance, ...taxRates,
      }),
    });
    const result = await response.json();
    if (!response.ok) { setBusy(false); return setError(result.error || "No se pudo emitir la solicitud"); }
    let pdfFailed = false;
    try { await downloadPurchaseOrderPdf(result.pdf); } catch { pdfFailed = true; }
    // La solicitud ya existe: sus productos salen del pedido aunque el PDF haya fallado.
    purchaseCart.clearSupplier(supplierId);
    onClosed({ number: result.purchase.number, supplierName, totalCents: result.purchase.amountCents, status: result.purchase.status, pdf: result.pdf, pdfFailed });
  }

  return <section className="cart-group">
    <header className="cart-group-head">
      <div><b>{supplierName}</b><small>{lines.length} {lines.length === 1 ? "producto" : "productos"} · {discountPct ? `descuento ${qty(discountPct)} %` : "sin descuento cargado"}</small></div>
      <strong>{money(totals.amountCents)}<small>con impuestos</small></strong>
    </header>
    <div className="cart-lines">{lines.map(line => <div className="cart-line" key={line.itemId}>
      <div className="cart-line-product"><b>{line.name}</b><small>{[line.code && `Cód. ${line.code}`, line.presentation, line.minSale && `Mínimo: ${line.minSale}`].filter(Boolean).join(" · ")}</small></div>
      <QuantityInput line={line} />
      <label className="cart-line-vat"><span>IVA</span>
        <select value={lineVatPct(line, vatPct)} aria-label={`IVA de ${line.name}`}
          onChange={event => { const rate = Number(event.target.value); purchaseCart.setVatPct(line.itemId, rate === vatPct ? undefined : rate); }}>
          {PURCHASE_VAT_RATES.map(rate => <option key={rate} value={rate}>{pctLabel(rate)}</option>)}
        </select></label>
      <div className="cart-line-price"><small>{money(line.ownCents)} c/u</small><b>{money(Math.round(line.ownCents * line.quantity))}</b></div>
      <button type="button" className="cart-remove" aria-label={`Sacar ${line.name} del pedido`} title="Sacar del pedido" onClick={() => purchaseCart.remove(line.itemId)}><Trash2 size={15} /></button>
    </div>)}</div>
    <dl className="cart-totals">
      <div><dt>Neto (sin IVA)</dt><dd>{money(totals.subtotalCents)}</dd></div>
      {totals.vatByRate.map(row => <div key={row.pct}><dt>IVA {pctLabel(row.pct)}</dt><dd>{money(row.vatCents)}</dd></div>)}
      {PURCHASE_PERCEPTIONS.map(({ key, label }) => taxRates[`${key}Pct`] > 0 && <div key={key}><dt>{label} {pctLabel(taxRates[`${key}Pct`])}</dt><dd>{money(totals[`${key}Cents`])}</dd></div>)}
      {taxRates.internalTaxPct > 0 && <div><dt>Impuesto interno {pctLabel(taxRates.internalTaxPct)}</dt><dd>{money(totals.internalTaxCents)}</dd></div>}
      <div className="total"><dt>Total</dt><dd>{money(totals.amountCents)}</dd></div>
    </dl>
    <div className="form-grid cart-form cart-taxes">
      <label htmlFor={`vat-${supplierId}`}><span>IVA de la solicitud<em className="field-hint">El de los renglones que no dicen otro</em></span>
        <select id={`vat-${supplierId}`} value={vatPct} onChange={event => setVatPct(Number(event.target.value))}>{PURCHASE_VAT_RATES.map(rate => <option key={rate} value={rate}>{pctLabel(rate)}</option>)}</select></label>
      <PctInput id={`perc-vat-${supplierId}`} label="Percepción de IVA" hint="Sobre el neto" value={rates.perceptionVatPct} onChange={setRate("perceptionVatPct")} />
      <PctInput id={`perc-iibb-${supplierId}`} label="Percepción de IIBB" hint="Sobre el neto" value={rates.perceptionIibbPct} onChange={setRate("perceptionIibbPct")} />
      <PctInput id={`perc-prov-${supplierId}`} label="IIBB provincial" hint="Sobre el neto" value={rates.perceptionIibbProvPct} onChange={setRate("perceptionIibbProvPct")} />
      <PctInput id={`internal-${supplierId}`} label="Impuesto interno" hint="Arranca en 0 %" value={rates.internalTaxPct} onChange={setRate("internalTaxPct")} />
    </div>
    <div className="form-grid cart-form">
      <label><span>Empresa que compra *<em className="field-hint">A su nombre va la factura del proveedor</em></span>
        <SearchSelect name={`company-${supplierId}`} value={company} onChange={value => setCompany(value || "tvp")}
          options={COMPANY_KEYS.map(key => ({ value: key, label: COMPANIES[key].legalName, hint: `CUIT ${COMPANIES[key].cuit}` }))} /></label>
      <label><span>Fecha de la solicitud *</span>
        <DateInput name={`date-${supplierId}`} required recent onValueChange={setOrderDate} /></label>
      <label><span>Entregar en<em className="field-hint">Dónde recibe la mercadería</em></span>
        <SearchSelect name={`deliver-${supplierId}`} options={DELIVERY_OPTIONS} value={deliverTo} onChange={setDeliverTo} /></label>
      <label><span>Obra{deliverTo === "obra" && " *"}<em className="field-hint">{deliverTo === "obra" ? "Obligatoria: a qué obra se entrega" : "Opcional: a qué obra va el material"}</em></span>
        <SearchSelect name={`work-${supplierId}`} options={works} value={workId} onChange={setWorkId} placeholder={deliverTo === "obra" ? "Elegí la obra" : "Sin obra (para depósito)"} required={deliverTo === "obra"} /></label>
      <label><span>Entrega esperada<em className="field-hint">Opcional</em></span>
        <DateInput name={`expected-${supplierId}`} quickRanges={[2, 7]} hideToday onValueChange={setExpectedDate} /></label>
      <label><span>Condición de compra *</span>
        <select value={paymentTerms} onChange={event => setPaymentTerms(event.target.value)}><option value="contado">Contado</option><option value="cuenta_corriente">Cuenta corriente</option><option value="plazo">A plazo</option></select></label>
      {paymentTerms === "plazo" && <label><span>Plazo en días *</span><input inputMode="numeric" value={termDays} onChange={event => setTermDays(event.target.value.replace(/\D/g, ""))} placeholder="30" /></label>}
      {paymentTerms === "contado" && <label><span>Medio de pago *<em className="field-hint">Tesorería lo ve en la orden de pago</em></span>
        <select value={cashMethod} onChange={event => setCashMethod(event.target.value)} required><option value="" disabled>Elegí…</option><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option></select></label>}
      <label className="invoice-expenses-check"><input type="checkbox" checked={requiresAdvance} onChange={event => setRequiresAdvance(event.target.checked)} />
        <span><b>Pide anticipo</b><small>Se paga antes de la entrega</small></span></label>
      <label className="wide"><span>Observaciones para el proveedor<em className="field-hint">Salen en el PDF: lugar de entrega, horario, contacto…</em></span>
        <textarea value={notes} maxLength={1000} onChange={event => setNotes(event.target.value)} placeholder="Ej.: entregar en obra 9 de Julio 1699, de 8 a 12 hs." /></label>
    </div>
    {error && <p className="form-error">{error}</p>}
    <div className="cart-group-foot">
      <span>Queda emitida en Solicitudes y órdenes, en sólo lectura, y se descarga el PDF. {totals.amountCents >= PURCHASE_APPROVAL_LIMIT_CENTS ? `Desde ${money(PURCHASE_APPROVAL_LIMIT_CENTS)} la autoriza Gerencia o Presidencia.` : "Queda autorizada y nace la orden de compra."}</span>
      <button type="button" className="primary-btn" disabled={busy} onClick={() => { void close(); }}>{busy ? "Emitiendo…" : "Emitir solicitud de compra"}</button>
    </div>
  </section>;
}
