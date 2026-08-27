"use client";

import { useEffect, useState } from "react";
import { ArrowDownToLine, HardHat, PackageSearch, Scale, X } from "lucide-react";
import { DateInput, MoneyInput, SearchSelect, type Option } from "@/components/fields";
import { date, dateTime, money, titleCase } from "@/lib/format";

export type StockMovement = {
  _id?: string; kind: "ingreso" | "egreso" | "ajuste"; quantity: number;
  unitCostCents?: number; totalCents?: number; reference?: string; note?: string;
  date?: string; userName?: string; createdAt?: string;
};

export type StockItem = {
  _id: string; name: string; unit: string; quantity: number; minQuantity: number;
  avgCostCents: number; valueCents: number; supplierId?: string; movements?: StockMovement[];
};

type Kind = "ingreso" | "egreso" | "ajuste";

const tabs: Array<{ kind: Kind; label: string; icon: typeof ArrowDownToLine; help: string }> = [
  { kind: "ingreso", label: "Registrar compra", icon: ArrowDownToLine, help: "Suma al depósito y deja la orden de compra recibida. Todavía no es costo de ninguna obra." },
  { kind: "egreso", label: "Entregar a obra", icon: HardHat, help: "Descuenta del depósito y carga el costo a la obra, valorizado al costo promedio." },
  { kind: "ajuste", label: "Ajustar inventario", icon: Scale, help: "Fija la cantidad que contaste físicamente. No mueve plata." },
];

export function StockMovementModal({ item, initialKind = "ingreso", onClose, onSaved }: {
  item: StockItem; initialKind?: Kind; onClose: () => void; onSaved: (item: StockItem) => void;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState(0);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [works, setWorks] = useState<Option[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const toOptions = (rows: Array<Record<string, unknown>>) => rows.map(row => ({
      value: String(row._id), label: String(row.name || row.code || ""), hint: row.code ? String(row.code) : undefined,
    }));
    void Promise.all([
      fetch("/api/records/suppliers?limit=100").then(response => response.ok ? response.json() : { items: [] }),
      // Solo las obras vivas: no tiene sentido entregar material a una obra terminada.
      fetch("/api/records/works?limit=100").then(response => response.ok ? response.json() : { items: [] }),
    ]).then(([supplierRows, workRows]) => {
      setSuppliers(toOptions(supplierRows.items || []));
      setWorks(toOptions((workRows.items || []).filter((row: Record<string, unknown>) => row.status !== "terminada" && row.status !== "cancelada")));
    });
  }, []);

  const amount = Number(quantity || 0);
  const previewCents = kind === "ingreso" ? Math.round(amount * unitCost * 100) : kind === "egreso" ? Math.round(amount * item.avgCostCents) : 0;
  const resulting = kind === "ajuste" ? amount : kind === "ingreso" ? item.quantity + amount : item.quantity - amount;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    const body = {
      kind, quantity: amount,
      unitCostCents: Math.round(Number(form.get("unitCostCents") || 0) * 100),
      supplierId: String(form.get("supplierId") || ""),
      workId: String(form.get("workId") || ""),
      reference: String(form.get("reference") || ""),
      note: String(form.get("note") || ""),
      date: String(form.get("date") || "") || undefined,
    };
    const response = await fetch(`/api/stock/${item._id}/movements`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setError(result.error || "No se pudo registrar el movimiento");
    onSaved(result as StockItem);
  }

  const current = tabs.find(tab => tab.kind === kind)!;

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal stock-modal" role="dialog" aria-modal="true" aria-labelledby="stock-modal-title">
      <header>
        <div className="modal-title-wrap"><span className="modal-heading-icon"><PackageSearch /></span><div>
          <p className="eyebrow">MOVIMIENTO DE STOCK</p>
          <h2 id="stock-modal-title">{item.name}</h2>
          <small>Cada entrada y salida queda registrada con usuario y fecha</small>
        </div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button>
      </header>

      <div className="stock-summary">
        <div><span>En stock</span><strong>{item.quantity} {item.unit}</strong></div>
        <div><span>Costo promedio</span><strong>{money(item.avgCostCents)}</strong></div>
        <div><span>Valorización</span><strong>{money(item.valueCents)}</strong></div>
        <div><span>Mínimo</span><strong className={item.minQuantity > 0 && item.quantity <= item.minQuantity ? "below" : ""}>{item.minQuantity || "—"}</strong></div>
      </div>

      <div className="stock-tabs" role="tablist">
        {tabs.map(tab => <button key={tab.kind} type="button" role="tab" aria-selected={kind === tab.kind}
          className={kind === tab.kind ? "active" : ""} onClick={() => { setKind(tab.kind); setError(""); }}>
          <tab.icon size={15} /> {tab.label}
        </button>)}
      </div>

      <form onSubmit={submit} key={kind}>
        <div className="modal-form-body">
          <p className="stock-help">{current.help}</p>
          <div className="form-grid">
            <label><span>{kind === "ajuste" ? "Cantidad contada *" : "Cantidad *"}</span>
              <input name="quantity" type="number" min="0" step="0.01" required autoFocus value={quantity} onChange={event => setQuantity(event.target.value)} placeholder={`En ${item.unit}`} />
            </label>

            {kind === "ingreso" && <label><span>Costo unitario *</span><MoneyInput name="unitCostCents" required onValueChange={setUnitCost} /></label>}
            {kind === "ingreso" && <label><span>Proveedor</span><SearchSelect name="supplierId" options={suppliers} defaultValue={item.supplierId || ""} placeholder="Elegí el proveedor…" /></label>}
            {kind === "egreso" && <label><span>Obra *</span><SearchSelect name="workId" options={works} required placeholder="¿A qué obra se entrega?" /></label>}

            {kind !== "ajuste" && <label><span>{kind === "ingreso" ? "Factura o remito" : "Remito de entrega"}</span><input name="reference" placeholder="Número del comprobante" /></label>}
            {kind !== "ajuste" && <label><span>Fecha</span><DateInput name="date" /></label>}
            <label className="wide"><span>Observaciones</span><textarea name="note" placeholder={kind === "egreso" ? "Quién retiró, en qué vehículo…" : "Detalle del movimiento"} /></label>
          </div>

          {amount > 0 && <div className="stock-preview">
            <div><span>Queda en stock</span><strong className={resulting < 0 ? "below" : ""}>{Math.round(resulting * 100) / 100} {item.unit}</strong></div>
            {kind !== "ajuste" && <div><span>{kind === "ingreso" ? "Total de la compra" : "Costo que va a la obra"}</span><strong>{money(previewCents)}</strong></div>}
          </div>}
        </div>

        {error && <p className="form-error modal-error">{error}</p>}
        <footer>
          <span>El movimiento queda auditado.</span>
          <button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button>
          <button className="primary-btn" disabled={saving || amount <= 0}>{saving ? "Registrando…" : current.label}</button>
        </footer>
      </form>

      <div className="modal-form-body">
        <div className="task-form-heading"><div><p className="eyebrow">MOVIMIENTOS</p><h3>Últimas entradas y salidas</h3></div><span>Más recientes primero</span></div>
        {!item.movements?.length ? <p className="task-history-state">Este material todavía no tuvo movimientos.</p>
          : <div className="detail-list">{item.movements.slice().reverse().slice(0, 12).map((movement, index) => <div className="detail-row stock-row" key={movement._id || index}>
            <span className={`badge ${movement.kind}`}>{titleCase(movement.kind)}</span>
            <b>{movement.quantity > 0 ? "+" : ""}{movement.quantity} {item.unit}</b>
            <span>{movement.note || movement.reference || "—"}</span>
            <strong>{movement.totalCents ? money(movement.totalCents) : "—"}</strong>
            <small>{movement.userName || "—"} · {date(movement.date) !== "—" ? date(movement.date) : dateTime(movement.createdAt)}</small>
          </div>)}</div>}
      </div>
    </section>
  </div>;
}
