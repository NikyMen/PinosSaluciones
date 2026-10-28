"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronUp, HardHat, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { money, qty } from "@/lib/format";
import { useWorkCart, workCart, type WorkCartLine } from "@/lib/work-cart";

/*
 * El carrito para salir a obra en la lista de Stock: cada fila suma su material
 * con la cantidad, y la barra de abajo muestra lo que se lleva y manda todo a la
 * Caja para hacer una sola salida (src/lib/work-cart.ts).
 */

const toNumber = (value: string) => Number(String(value).replace(",", ".")) || 0;

/** La cantidad que se escribe a mano: se guarda al salir del cuadro, para poder borrar y escribir otra. */
function QtyStepper({ line, label }: { line: WorkCartLine; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null) { workCart.setQuantity(line.item._id, toNumber(draft)); setDraft(null); } };
  return <div className="work-cart-qty">
    <button type="button" onClick={() => workCart.setQuantity(line.item._id, line.quantity - 1)} aria-label={`Uno menos de ${label}`}><Minus size={14} /></button>
    <input inputMode="decimal" value={draft ?? String(line.quantity).replace(".", ",")} aria-label={`Cantidad de ${label} en el carrito`}
      onFocus={event => event.target.select()}
      onChange={event => setDraft(event.target.value.replace(/[^\d,.]/g, ""))}
      onBlur={commit} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} />
    <button type="button" onClick={() => workCart.setQuantity(line.item._id, line.quantity + 1)} aria-label={`Uno más de ${label}`}><Plus size={14} /></button>
  </div>;
}

/** En cada fila de Stock: "Carrito" la primera vez, y después cuántos van, para subir o bajar. */
export function WorkCartRowControl({ item }: { item: Record<string, unknown> }) {
  const lines = useWorkCart();
  const line = lines.find(entry => entry.item._id === String(item._id));
  const name = String(item.name || "el material");
  if (!line) return <button type="button" className="row-action-wide work-cart-add" title="Sumar al carrito para salir a obra" onClick={() => workCart.add(item)}><ShoppingCart size={15} /> Carrito</button>;
  return <span className="work-cart-row" title={`En el carrito: ${qty(line.quantity)} ${line.item.unit}`}><ShoppingCart size={14} /><QtyStepper line={line} label={name} /></span>;
}

/** La barra fija de abajo con lo que hay en el carrito. Sin nada, no se ve. */
export function WorkCartBar() {
  const lines = useWorkCart();
  const [open, setOpen] = useState(false);
  if (!lines.length) return null;
  const units = lines.reduce((total, line) => total + line.quantity, 0);
  const costCents = lines.reduce((total, line) => total + Math.round(line.quantity * Number(line.item.avgCostCents || 0)), 0);
  return <section className={open ? "work-cart-bar open" : "work-cart-bar"} aria-label="Carrito para salir a obra">
    {open && <ul className="work-cart-lines">
      {lines.map(line => <li key={line.item._id}>
        <span><b>{line.item.name}</b><small>{line.item.unit}{line.item.avgCostCents ? ` · ${money(Math.round(line.quantity * Number(line.item.avgCostCents)))}` : ""}</small></span>
        <QtyStepper line={line} label={line.item.name} />
        <button type="button" className="icon-btn" title="Sacar del carrito" aria-label={`Sacar ${line.item.name} del carrito`} onClick={() => workCart.remove(line.item._id)}><Trash2 size={15} /></button>
      </li>)}
    </ul>}
    <div className="work-cart-summary">
      <button type="button" className="work-cart-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <ShoppingCart size={18} />
        <span><b>Carrito para obra</b><small>{lines.length} {lines.length === 1 ? "material" : "materiales"} · {qty(units)} {units === 1 ? "unidad" : "unidades"} · costo aprox. {money(costCents)}</small></span>
        {open ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
      </button>
      <button type="button" className="secondary-btn" onClick={() => { if (confirm("¿Vaciar el carrito?")) workCart.clear(); }}><Trash2 size={15} /> Vaciar</button>
      <Link className="primary-btn" href="/app/caja?carrito=1"><HardHat size={16} /> Hacer salida a obra</Link>
    </div>
  </section>;
}
