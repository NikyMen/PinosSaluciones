"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { MoneyInput } from "@/components/fields";
import { StockPicker } from "@/components/stock-picker";
import { invoiceLineCents, type InvoiceLine } from "@/lib/invoice-lines";
import { money } from "@/lib/format";

export type EditableInvoiceLine = InvoiceLine & { key: string };

export function InvoiceLineEditor({ lines, onChange }: { lines: EditableInvoiceLine[]; onChange: (rows: EditableInvoiceLine[]) => void }) {
  const [showStock, setShowStock] = useState(false);
  const update = (key: string, patch: Partial<InvoiceLine>) => onChange(lines.map(row => row.key === key ? { ...row, ...patch } : row));
  return <fieldset>
    <legend><b>Productos y conceptos</b></legend>
    {lines.length > 0 && <div className="purchase-item-list">
      {lines.map((row, index) => <fieldset key={row.key} className="form-grid">
        <legend>{row.stockItemId ? "Producto del Salón" : "Concepto"}</legend>
        <label className="wide"><span>Descripción *</span><input required maxLength={300} value={row.description} onChange={event => update(row.key, { description: event.target.value })} /></label>
        <label><span>Cantidad *</span><input required type="number" step="0.001" min="0.001" value={row.quantity || ""} onChange={event => update(row.key, { quantity: Number(event.target.value) })} /></label>
        <label><span>Unidad *</span><input required maxLength={24} value={row.unit} onChange={event => update(row.key, { unit: event.target.value })} /></label>
        <label><span>Precio unitario</span><MoneyInput name={`invoice-price-${row.key}`} defaultValue={row.unitCents / 100} onValueChange={value => update(row.key, { unitCents: Math.round(value * 100) })} /></label>
        <div><span>Subtotal {money(invoiceLineCents(row))}</span> <button type="button" className="icon-btn" aria-label={`Quitar renglón ${index + 1}`} onClick={() => onChange(lines.filter(line => line.key !== row.key))}><X size={15} /></button></div>
      </fieldset>)}
    </div>}
    <div className="toolbar">
      <button type="button" className="secondary-btn" disabled={lines.length >= 100} onClick={() => onChange([...lines, { key: crypto.randomUUID(), description: "", unit: "unidad", quantity: 1, unitCents: 0 }])}><Plus size={16} /> Agregar concepto</button>
      <button type="button" className="secondary-btn" aria-expanded={showStock} disabled={lines.length >= 100} onClick={() => setShowStock(!showStock)}>Buscar producto del Salón</button>
    </div>
    {showStock && lines.length < 100 && <StockPicker warehouse="salon" exclude={lines.flatMap(row => row.stockItemId ? [row.stockItemId] : [])} onPick={item => {
      onChange([...lines, { key: crypto.randomUUID(), stockItemId: item._id, description: item.name, unit: item.unit, quantity: 1, unitCents: Number(item.salePriceCents || 0) }]);
      setShowStock(false);
    }} />}
    <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ stockItemId, description, quantity, unit, unitCents }) => ({ stockItemId, description, quantity, unit, unitCents })))} />
  </fieldset>;
}
