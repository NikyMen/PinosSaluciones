"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, PackagePlus, Warehouse, X } from "lucide-react";
import { qty } from "@/lib/format";
import { WAREHOUSES, warehouseLabel, type WarehouseKey } from "@/lib/warehouses";

type Line = { code?: string; name: string; presentation?: string; quantity: number };
type Result = { number: string; warehouse: WarehouseKey; created: number; items: Array<{ name: string; quantity: number; unit: string; isNew: boolean }> };

/**
 * Llegó la mercadería de una orden de compra. Antes de sumarla se pregunta a
 * qué depósito entra: por defecto, donde se pidió que entreguen.
 */
export function ReceivePurchaseModal({ purchase, onClose, onDone }: { purchase: Record<string, unknown> & { _id: string }; onClose: () => void; onDone: () => void }) {
  const deliverTo = String(purchase.deliverTo || "");
  const [warehouse, setWarehouse] = useState<WarehouseKey>(WAREHOUSES.some(entry => entry.key === deliverTo) ? deliverTo as WarehouseKey : "central");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const lines = (Array.isArray(purchase.items) ? purchase.items : []) as Line[];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function receive() {
    setBusy(true); setError("");
    const response = await fetch(`/api/purchases/${purchase._id}/receive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ warehouse }) });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return setError(body.error || "No se pudo pasar la orden al stock");
    setResult(body);
    onDone();
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal receive-modal" role="dialog" aria-modal="true" aria-labelledby="receive-modal-title">
      <header>
        <div className="modal-title-wrap"><span className="modal-heading-icon"><PackagePlus /></span><div>
          <p className="eyebrow">ORDEN {String(purchase.number || "")}</p>
          <h2 id="receive-modal-title">Pasar a stock</h2>
          <small>Llegó la mercadería: sus productos suman al depósito que elijas</small>
        </div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button>
      </header>
      <div className="modal-form-body">
        {result ? <div className="notice success receive-result">
          <CheckCircle2 size={18} />
          <div>
            <b>Listo: {result.items.length} {result.items.length === 1 ? "producto entró" : "productos entraron"} al {warehouseLabel(result.warehouse)}.</b>
            {result.created > 0 && <p>{result.created} {result.created === 1 ? "no estaba en el stock y se dio de alta" : "no estaban en el stock y se dieron de alta"} con el código del proveedor.</p>}
            <ul>{result.items.map((item, index) => <li key={index}>{qty(item.quantity)} {item.unit} · {item.name}{item.isNew ? " (nuevo)" : ""}</li>)}</ul>
            <Link href="/app/stock">Ver el stock</Link>
          </div>
        </div> : <>
          <p className="receive-question">¿A qué depósito entra la mercadería?</p>
          <div className="receive-options" role="radiogroup" aria-label="Depósito">
            {WAREHOUSES.map(entry => <button key={entry.key} type="button" role="radio" aria-checked={warehouse === entry.key} className={warehouse === entry.key ? "active" : ""} onClick={() => setWarehouse(entry.key)}>
              <Warehouse size={18} /><span><b>{entry.label}</b><small>{entry.key === "central" ? "Recepción de proveedores" : "Mostrador y venta al público"}</small></span>
            </button>)}
          </div>
          {deliverTo === "obra" && <p className="convert-warning"><span>La orden se pidió para entregar en la obra. Elegí el depósito donde queda registrada y después hacé la salida a obra desde Stock: así sale con su remito y el costo va a la obra.</span></p>}
          <p className="eyebrow receive-list-title">ENTRAN {lines.length} {lines.length === 1 ? "PRODUCTO" : "PRODUCTOS"}</p>
          <ul className="receive-lines">{lines.map((line, index) => <li key={index}><b>{qty(line.quantity)}</b><span>{line.name}{line.presentation ? ` · ${line.presentation}` : ""}</span>{line.code && <small>{line.code}</small>}</li>)}</ul>
          <p className="receive-note">Cada producto se busca en el stock por su código; si no está, se da de alta. Entra al costo de la orden (con el descuento, sin IVA) y la orden queda como recibida. Se pasa una sola vez.</p>
        </>}
        {error && <p className="form-error">{error}</p>}
      </div>
      <footer>
        <span>Queda auditado a tu nombre.</span>
        <button type="button" className="secondary-btn" onClick={onClose}>{result ? "Cerrar" : "Cancelar"}</button>
        {!result && <button type="button" className="primary-btn" disabled={busy} onClick={() => { void receive(); }}>{busy ? "Pasando…" : `Pasar al ${warehouseLabel(warehouse)}`}</button>}
      </footer>
    </section>
  </div>;
}
