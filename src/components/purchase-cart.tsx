"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import { money, qty } from "@/lib/format";
import { VAT_RATE } from "@/lib/price-lists";
import { purchaseCart, usePurchaseCart, type CartLine } from "@/lib/purchase-cart";
import { downloadPurchaseOrderPdf, type PurchaseOrderPdfData } from "@/lib/purchase-order-pdf";
import { DateInput, SearchSelect, type Option } from "@/components/fields";

/*
 * El pedido de compra: lo que se fue agregando desde el buscador, separado por
 * proveedor, porque a cada proveedor se le manda su propia orden. Cerrar la
 * orden la guarda en "Órdenes de compra" y descarga el PDF para pasárselo.
 */

type Closed = { number: string; supplierName: string; totalCents: number; pdf: PurchaseOrderPdfData; pdfFailed: boolean };

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
    fetch("/api/records/works?limit=100")
      .then(response => response.ok ? response.json() : { items: [] })
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
          <small>Una orden de compra por proveedor. Al cerrarla se confirman los precios con la lista vigente.</small>
        </div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button>
      </header>
      <div className="modal-form-body cart-body">
        {closed.map(order => <div className="notice success cart-closed" key={order.number}>
          <CheckCircle2 size={18} />
          <span><b>Orden {order.number} cerrada</b> · {order.supplierName} · {money(order.totalCents)} con IVA.{" "}
            {order.pdfFailed ? "No se pudo generar el PDF: bajalo de nuevo." : "El PDF ya se descargó."}{" "}
            <Link href="/app/purchases">Ver en Órdenes de compra</Link></span>
          <button type="button" className="secondary-btn" onClick={() => { void downloadPurchaseOrderPdf(order.pdf); }}><Download size={15} /> PDF</button>
        </div>)}
        {!groups.length && <div className="empty-state compact"><ShoppingCart size={26} /><p>{closed.length ? "No quedan productos en el pedido." : "Todavía no agregaste productos. Usá el botón “Agregar” de cada producto en el buscador de precios."}</p></div>}
        {groups.map(group => <SupplierOrder key={group[0].supplierId} lines={group} works={works}
          onClosed={order => setClosed(current => [order, ...current])} />)}
      </div>
      <footer><span>El pedido queda guardado en este navegador hasta que cierres la orden.</span><button type="button" className="secondary-btn" onClick={onClose}>Seguir buscando</button></footer>
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

function SupplierOrder({ lines, works, onClosed }: { lines: CartLine[]; works: Option[]; onClosed: (order: Closed) => void }) {
  const [workId, setWorkId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { supplierId, supplierName, discountPct } = lines[0];
  const subtotal = lines.reduce((total, line) => total + Math.round(line.ownCents * line.quantity), 0);
  const vat = Math.round(subtotal * VAT_RATE);

  async function close() {
    setBusy(true); setError("");
    const response = await fetch("/api/purchases/orders", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ supplierId, items: lines.map(line => ({ itemId: line.itemId, quantity: line.quantity })), workId, expectedDate, notes }),
    });
    const result = await response.json();
    if (!response.ok) { setBusy(false); return setError(result.error || "No se pudo cerrar la orden"); }
    let pdfFailed = false;
    try { await downloadPurchaseOrderPdf(result.pdf); } catch { pdfFailed = true; }
    // La orden ya existe: sus productos salen del pedido aunque el PDF haya fallado.
    purchaseCart.clearSupplier(supplierId);
    onClosed({ number: result.purchase.number, supplierName, totalCents: result.purchase.amountCents, pdf: result.pdf, pdfFailed });
  }

  return <section className="cart-group">
    <header className="cart-group-head">
      <div><b>{supplierName}</b><small>{lines.length} {lines.length === 1 ? "producto" : "productos"} · {discountPct ? `descuento ${qty(discountPct)} %` : "sin descuento cargado"}</small></div>
      <strong>{money(subtotal + vat)}<small>con IVA</small></strong>
    </header>
    <div className="cart-lines">{lines.map(line => <div className="cart-line" key={line.itemId}>
      <div className="cart-line-product"><b>{line.name}</b><small>{[line.code && `Cód. ${line.code}`, line.presentation, line.minSale && `Mínimo: ${line.minSale}`].filter(Boolean).join(" · ")}</small></div>
      <QuantityInput line={line} />
      <div className="cart-line-price"><small>{money(line.ownCents)} c/u</small><b>{money(Math.round(line.ownCents * line.quantity))}</b></div>
      <button type="button" className="cart-remove" aria-label={`Sacar ${line.name} del pedido`} title="Sacar del pedido" onClick={() => purchaseCart.remove(line.itemId)}><Trash2 size={15} /></button>
    </div>)}</div>
    <dl className="cart-totals">
      <div><dt>Subtotal sin IVA</dt><dd>{money(subtotal)}</dd></div>
      <div><dt>IVA {Math.round(VAT_RATE * 100)} %</dt><dd>{money(vat)}</dd></div>
      <div className="total"><dt>Total</dt><dd>{money(subtotal + vat)}</dd></div>
    </dl>
    <div className="form-grid cart-form">
      <label><span>Obra<em className="field-hint">Opcional: a qué obra va el material</em></span>
        <SearchSelect name={`work-${supplierId}`} options={works} value={workId} onChange={setWorkId} placeholder="Sin obra (para depósito)" /></label>
      <label><span>Entrega esperada<em className="field-hint">Opcional</em></span>
        <DateInput name={`expected-${supplierId}`} quickRanges={[2, 7]} hideToday onValueChange={setExpectedDate} /></label>
      <label className="wide"><span>Observaciones para el proveedor<em className="field-hint">Salen en el PDF: lugar de entrega, horario, contacto…</em></span>
        <textarea value={notes} maxLength={1000} onChange={event => setNotes(event.target.value)} placeholder="Ej.: entregar en obra 9 de Julio 1699, de 8 a 12 hs." /></label>
    </div>
    {error && <p className="form-error">{error}</p>}
    <div className="cart-group-foot">
      <span>Se guarda en Órdenes de compra y se descarga el PDF.</span>
      <button type="button" className="primary-btn" disabled={busy} onClick={() => { void close(); }}>{busy ? "Cerrando la orden…" : "Cerrar orden de compra"}</button>
    </div>
  </section>;
}
