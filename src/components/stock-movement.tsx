"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowRightLeft, Check, FileText, HardHat, PackageSearch, Scale, X } from "lucide-react";
import { DateInput, MoneyInput, SearchSelect, type Option } from "@/components/fields";
import { date, dateTime, money, qty } from "@/lib/format";
import { levelsOf, minimumsOf, splitDelivery, totalOf, type Levels } from "@/lib/stock-levels";
import { WAREHOUSES, warehouseLabel, type WarehouseKey } from "@/lib/warehouses";
import { downloadRemitoPdf, remitoFromMovement } from "@/lib/remito-pdf";

export type StockMovement = {
  _id?: string; kind: "ingreso" | "egreso" | "transferencia" | "ajuste"; quantity: number;
  warehouse?: string; toWarehouse?: string; remito?: string; destinationLabel?: string; quoteNumber?: string;
  unitCostCents?: number; totalCents?: number; reference?: string; note?: string;
  date?: string; userName?: string; createdAt?: string;
};

export type StockItem = {
  _id: string; name: string; sku?: string; unit: string; quantity: number; minQuantity: number;
  avgCostCents: number; valueCents: number; supplierId?: string; movements?: StockMovement[];
} & Record<string, unknown>;

type Kind = StockMovement["kind"];

const tabs: Array<{ kind: Kind; label: string; icon: typeof ArrowDownToLine; help: string }> = [
  { kind: "ingreso", label: "Entrada", icon: ArrowDownToLine, help: "Una compra que llegó: suma al depósito donde entró. Todavía no es costo de ninguna obra." },
  { kind: "transferencia", label: "Pasar entre depósitos", icon: ArrowRightLeft, help: "Mueve material de un depósito al otro, con su remito. No mueve plata ni cambia el costo." },
  { kind: "egreso", label: "Salida a obra", icon: HardHat, help: "Sale del Central y, si no alcanza, lo que falta sale del Salón. Un remito por depósito. Carga el costo a la obra; no es una venta." },
  { kind: "ajuste", label: "Ajustar inventario", icon: Scale, help: "Fija lo que contaste físicamente en un depósito. No mueve plata." },
];

const movementLabels: Record<Kind, string> = { ingreso: "Entrada", egreso: "Salida a obra", transferencia: "Pase", ajuste: "Ajuste" };
const warehouseOptions: Option[] = WAREHOUSES.map(warehouse => ({ value: warehouse.key, label: warehouse.label }));
const round = (value: number) => Math.round(value * 1000) / 1000;

export function StockMovementModal({ item, initialKind = "ingreso", onClose, onSaved }: {
  item: StockItem; initialKind?: Kind; onClose: () => void; onSaved: (item: StockItem) => void;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState(0);
  const [warehouse, setWarehouse] = useState<WarehouseKey>("central");
  const [toWarehouse, setToWarehouse] = useState<WarehouseKey>("salon");
  // Salida a obra: el reparto sale solo (Central primero); "a mano" deja elegir cuánto de cada uno.
  const [manualSplit, setManualSplit] = useState(false);
  const [manualParts, setManualParts] = useState<Record<string, string>>({});
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [works, setWorks] = useState<Option[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<StockMovement[]>([]);
  // Segundo paso del guardado: el botón pasa de "registrar" a "sí, confirmar".
  const [confirming, setConfirming] = useState(false);

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
    }).catch(() => setError("No se pudieron cargar proveedores y obras"));
  }, []);

  const levels = useMemo(() => levelsOf(item), [item]);
  const minimums = useMemo(() => minimumsOf(item), [item]);
  const amount = Number(String(quantity).replace(",", ".")) || 0;

  const delivery = useMemo(() => {
    if (!manualSplit) return splitDelivery(levels, amount);
    const parts = WAREHOUSES.map(entry => ({ warehouse: entry.key, quantity: Number(String(manualParts[entry.key] || "").replace(",", ".")) || 0 })).filter(part => part.quantity > 0);
    return { parts, missing: 0 };
  }, [manualSplit, manualParts, levels, amount]);
  const deliveryTotal = round(delivery.parts.reduce((total, part) => total + part.quantity, 0));

  // Cómo queda cada depósito si se confirma.
  const after: Levels = { ...levels };
  if (kind === "ingreso") after[warehouse] = round(after[warehouse] + amount);
  if (kind === "ajuste") after[warehouse] = round(amount);
  if (kind === "transferencia") { after[warehouse] = round(after[warehouse] - amount); after[toWarehouse] = round(after[toWarehouse] + amount); }
  if (kind === "egreso") for (const part of delivery.parts) after[part.warehouse] = round(after[part.warehouse] - part.quantity);
  const negative = WAREHOUSES.some(entry => after[entry.key] < 0) || (kind === "egreso" && !manualSplit && delivery.missing > 0);
  const moved = kind === "egreso" ? deliveryTotal : amount;
  const previewCents = kind === "ingreso" ? Math.round(amount * unitCost * 100) : kind === "egreso" ? Math.round(deliveryTotal * item.avgCostCents) : 0;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Un movimiento de stock corrige cantidades y costos: se confirma dos veces,
    // con el resultado a la vista, antes de tocar la existencia.
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    const common = { note: String(form.get("note") || ""), date: String(form.get("date") || "") || undefined };
    const body = kind === "ingreso"
      ? { kind, warehouse, quantity: amount, unitCostCents: Math.round(Number(form.get("unitCostCents") || 0) * 100), supplierId: String(form.get("supplierId") || ""), reference: String(form.get("reference") || ""), ...common }
      : kind === "egreso"
        ? { kind, workId: String(form.get("workId") || ""), parts: delivery.parts, reference: "", ...common }
        : kind === "transferencia"
          ? { kind, from: warehouse, to: toWarehouse, quantity: amount, ...common }
          : { kind, warehouse, quantity: amount, ...common };
    const response = await fetch(`/api/stock/${item._id}/movements`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setError(result.error || "No se pudo registrar el movimiento");
    setDone((result.movements || []) as StockMovement[]);
    setQuantity(""); setManualParts({});
    onSaved(result.item as StockItem);
  }

  const current = tabs.find(tab => tab.kind === kind)!;
  const remitos = done.filter(movement => movement.remito);

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal stock-modal" role="dialog" aria-modal="true" aria-labelledby="stock-modal-title">
      <header>
        <div className="modal-title-wrap"><span className="modal-heading-icon"><PackageSearch /></span><div>
          <p className="eyebrow">MOVIMIENTO DE STOCK</p>
          <h2 id="stock-modal-title">{item.name}</h2>
          <small>Cada entrada, pase y salida queda registrada con usuario y fecha</small>
        </div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button>
      </header>

      <div className="stock-summary">
        {WAREHOUSES.map(entry => <div key={entry.key}>
          <span>{entry.label}</span>
          <strong className={minimums[entry.key] > 0 && levels[entry.key] <= minimums[entry.key] ? "below" : ""}>{qty(levels[entry.key])} {item.unit}</strong>
          <small>{minimums[entry.key] > 0 ? `Mínimo ${qty(minimums[entry.key])}` : "Sin mínimo"}</small>
        </div>)}
        <div><span>Total</span><strong>{qty(totalOf(levels))} {item.unit}</strong><small>Costo promedio {money(item.avgCostCents)}</small></div>
        <div><span>Valorización</span><strong>{money(item.valueCents)}</strong></div>
      </div>

      <div className="stock-tabs" role="tablist">
        {tabs.map(tab => <button key={tab.kind} type="button" role="tab" aria-selected={kind === tab.kind}
          className={kind === tab.kind ? "active" : ""} onClick={() => { setKind(tab.kind); setError(""); setConfirming(false); setDone([]); }}>
          <tab.icon size={15} /> {tab.label}
        </button>)}
      </div>

      {remitos.length > 0 && <div className="notice success stock-done">
        <Check size={17} />
        <span>Listo. {remitos.length === 1 ? "Se generó el remito" : "Se generaron los remitos"} {remitos.map(movement => movement.remito).join(" y ")}.</span>
        {remitos.map(movement => <button key={movement.remito} type="button" className="secondary-btn" onClick={() => { void downloadRemitoPdf(remitoFromMovement(movement, item)); }}><FileText size={15} /> {movement.remito}</button>)}
      </div>}

      <form onSubmit={submit} key={kind}>
        <div className="modal-form-body">
          <p className="stock-help">{current.help}</p>
          <div className="form-grid">
            {kind === "transferencia" ? <>
              <label><span>Sale de *</span><SearchSelect name="from" options={warehouseOptions} value={warehouse} onChange={value => { setWarehouse(value as WarehouseKey); if (value === toWarehouse) setToWarehouse(WAREHOUSES.find(entry => entry.key !== value)!.key); }} /></label>
              <label><span>Va a *</span><SearchSelect name="to" options={warehouseOptions.filter(option => option.value !== warehouse)} value={toWarehouse} onChange={value => setToWarehouse(value as WarehouseKey)} /></label>
            </> : kind !== "egreso" && <label><span>{kind === "ingreso" ? "Entra al depósito *" : "Depósito que contaste *"}</span>
              <SearchSelect name="warehouse" options={warehouseOptions} value={warehouse} onChange={value => setWarehouse(value as WarehouseKey)} /></label>}

            {kind === "egreso" && <label><span>Obra *</span><SearchSelect name="workId" options={works} required placeholder="¿A qué obra se entrega?" /></label>}

            {!(kind === "egreso" && manualSplit) && <label><span>{kind === "ajuste" ? "Cantidad contada *" : "Cantidad *"}</span>
              <input name="quantity" inputMode="decimal" required autoFocus value={quantity} onChange={event => setQuantity(event.target.value.replace(/[^\d,.]/g, ""))} placeholder={`En ${item.unit}`} />
            </label>}

            {kind === "egreso" && manualSplit && WAREHOUSES.map(entry => <label key={entry.key}><span>Desde {entry.label}<em className="field-hint">Hay {qty(levels[entry.key])} {item.unit}</em></span>
              <input inputMode="decimal" value={manualParts[entry.key] || ""} onChange={event => setManualParts(current => ({ ...current, [entry.key]: event.target.value.replace(/[^\d,.]/g, "") }))} placeholder="0" /></label>)}

            {kind === "ingreso" && <label><span>Costo unitario *</span><MoneyInput name="unitCostCents" required onValueChange={setUnitCost} /></label>}
            {kind === "ingreso" && <label><span>Proveedor</span><SearchSelect name="supplierId" options={suppliers} defaultValue={item.supplierId || ""} placeholder="Elegí el proveedor…" /></label>}
            {kind === "ingreso" && <label><span>Factura o remito del proveedor</span><input name="reference" placeholder="Número del comprobante" /></label>}
            {kind !== "ajuste" && <label><span>Fecha</span><DateInput name="date" /></label>}
            <label className="wide"><span>Observaciones</span><textarea name="note" placeholder={kind === "egreso" ? "Quién retiró, en qué vehículo…" : "Detalle del movimiento"} /></label>
          </div>

          {kind === "egreso" && <div className="stock-split">
            {moved > 0 && <p>{delivery.parts.length
              ? <>Sale {delivery.parts.map(part => `${qty(part.quantity)} ${item.unit} del ${warehouseLabel(part.warehouse)}`).join(" y ")}{delivery.parts.length > 1 ? " · un remito por depósito" : ""}.</>
              : "Todavía no sale nada."}{!manualSplit && delivery.missing > 0 && <b className="below"> Faltan {qty(delivery.missing)} {item.unit}: entre los dos depósitos no alcanza.</b>}</p>}
            <button type="button" className="secondary-btn" onClick={() => { setManualSplit(value => !value); setManualParts(Object.fromEntries(delivery.parts.map(part => [part.warehouse, String(part.quantity)]))); }}>
              {manualSplit ? "Repartir solo (Central primero)" : "Elegir cuánto sale de cada depósito"}
            </button>
          </div>}

          {moved > 0 && <div className="stock-preview">
            {WAREHOUSES.map(entry => <div key={entry.key}><span>Queda en {entry.short}</span><strong className={after[entry.key] < 0 ? "below" : ""}>{qty(after[entry.key])} {item.unit}</strong></div>)}
            {(kind === "ingreso" || kind === "egreso") && <div><span>{kind === "ingreso" ? "Total de la compra" : "Costo que va a la obra"}</span><strong>{money(previewCents)}</strong></div>}
          </div>}
        </div>

        {error && <p className="form-error modal-error">{error}</p>}
        <footer>
          <span>{confirming
            ? `${current.label}: ${qty(moved)} ${item.unit}. Queda auditado a tu nombre.`
            : "El movimiento queda auditado."}</span>
          <button type="button" className="secondary-btn" onClick={() => confirming ? setConfirming(false) : onClose()}>{confirming ? "Volver" : "Cancelar"}</button>
          <button className={confirming ? "primary-btn confirming" : "primary-btn"} disabled={saving || moved <= 0 || negative}>{saving ? "Registrando…" : confirming ? <><Check size={16} /> Sí, confirmar</> : current.label}</button>
        </footer>
      </form>

      <div className="modal-form-body">
        <div className="task-form-heading"><div><p className="eyebrow">MOVIMIENTOS</p><h3>Últimos movimientos</h3></div><span>Más recientes primero</span></div>
        {!item.movements?.length ? <p className="task-history-state">Este material todavía no tuvo movimientos.</p>
          : <div className="detail-list">{item.movements.slice().reverse().slice(0, 12).map((movement, index) => <div className="detail-row stock-row" key={movement._id || index}>
            <span className={`badge ${movement.kind}`}>{movementLabels[movement.kind] || movement.kind}</span>
            <b>{movement.kind === "ajuste" && movement.quantity > 0 ? "+" : ""}{qty(movement.quantity)} {item.unit}</b>
            <span>{movement.kind === "transferencia" ? `${warehouseLabel(movement.warehouse)} → ${warehouseLabel(movement.toWarehouse)}` : `${movement.warehouse ? warehouseLabel(movement.warehouse) : "Depósito Central"}${movement.kind === "egreso" ? ` → ${movement.destinationLabel || movement.note || "obra"}` : ""}`}</span>
            <strong>{movement.totalCents ? money(movement.totalCents) : "—"}</strong>
            <small>{movement.userName || "—"} · {date(movement.date) !== "—" ? date(movement.date) : dateTime(movement.createdAt)}</small>
            {movement.remito && <button type="button" className="stock-remito" onClick={() => { void downloadRemitoPdf(remitoFromMovement(movement, item)); }} title="Descargar el remito en PDF"><FileText size={13} /> {movement.remito}</button>}
          </div>)}</div>}
      </div>
    </section>
  </div>;
}
