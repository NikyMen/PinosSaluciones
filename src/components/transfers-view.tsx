"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, Check, FileText, PackageCheck, Plus, Trash2, X } from "lucide-react";
import { dateTime, qty } from "@/lib/format";
import { WAREHOUSES, warehouseLabel, type WarehouseKey } from "@/lib/warehouses";
import { downloadRemitoPdf } from "@/lib/remito-pdf";
import { ownerLabels, type OwnerPart } from "@/lib/stock-owners";
import { StockPicker, type PickedItem } from "@/components/stock-picker";

type Line = { stockItemId: string; name: string; unit: string; quantity: number; ownerParts?: OwnerPart[]; receivedQty?: number; damagedQty?: number; missingQty?: number; note?: string };
type Transfer = { _id: string; number: string; from: WarehouseKey; to: WarehouseKey; status: "en_transito" | "recibida" | "con_diferencias" | "anulada"; lines: Line[]; note?: string; receptionNote?: string; sentAt: string; sentByName?: string; receivedAt?: string; receivedByName?: string };

const statusLabels: Record<Transfer["status"], string> = { en_transito: "En tránsito", recibida: "Recibida", con_diferencias: "Recibida con diferencias", anulada: "Anulada" };

const parts = (line: Line) => (line.ownerParts || []).map(part => `${ownerLabels[part.owner]} ${qty(part.quantity)}`).join(" · ");

function remitoData(transfer: Transfer) {
  return { number: transfer.number, date: transfer.sentAt, kind: "transferencia" as const, fromWarehouse: warehouseLabel(transfer.from), destination: warehouseLabel(transfer.to), items: transfer.lines.map(line => ({ name: line.name, unit: line.unit, quantity: line.quantity })), note: transfer.note, userName: transfer.sentByName };
}

/**
 * Transferencias entre depósitos: salen con remito, quedan en tránsito y el
 * depósito de destino confirma lo que llegó. Lo que faltó o llegó dañado queda
 * anotado en el renglón.
 */
export function TransfersView({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Transfer[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<Transfer | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/transfers");
    const body = await response.json();
    if (response.ok) setRows(body.items); else { setRows([]); setError(body.error || "No se pudieron leer las transferencias"); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function cancel(transfer: Transfer) {
    const reason = prompt(`¿Por qué se anula la transferencia ${transfer.number}? El material vuelve al ${warehouseLabel(transfer.from)}.`);
    if (!reason) return;
    const response = await fetch(`/api/transfers/${transfer._id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
    const body = await response.json();
    if (!response.ok) return setError(body.error || "No se pudo anular");
    setNotice(`Transferencia ${transfer.number} anulada: el material volvió al ${warehouseLabel(transfer.from)}.`);
    void load();
  }

  const pending = (rows || []).filter(row => row.status === "en_transito");

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">STOCK Y LOGÍSTICA</p>
      <h1>Transferencias</h1>
      <p>Del Depósito Central al Salón de Ventas (o al revés). Sale con remito, queda en tránsito y el destino confirma lo que recibió. No es una venta: solo cambia dónde está el material.</p>
    </div>{canEdit && <button className="primary-btn" onClick={() => setCreating(true)}><Plus size={18} /> Nueva transferencia</button>}</div>
    {error && <div className="notice error">{error}</div>}
    {notice && <div className="notice success" role="status">{notice}</div>}
    {pending.length > 0 && <div className="notice warning">{pending.length} {pending.length === 1 ? "transferencia sigue" : "transferencias siguen"} en tránsito: el destino tiene que confirmar la recepción.</div>}
    <section className="table-panel">
      {rows === null ? <div className="loading-state">Cargando…</div> : !rows.length ? <div className="empty-state"><p>Todavía no hay transferencias.</p></div>
        : <div className="table-scroll"><table><thead><tr><th>Remito</th><th>Salió</th><th>Recorrido</th><th>Materiales</th><th>Estado</th><th>Recepción</th><th /></tr></thead><tbody>
          {rows.map(row => <tr key={row._id}>
            <td data-label="Remito"><b>{row.number}</b></td>
            <td data-label="Salió">{dateTime(row.sentAt)}<small className="tracking-sub">{row.sentByName}</small></td>
            <td data-label="Recorrido">{warehouseLabel(row.from)} → {warehouseLabel(row.to)}</td>
            <td data-label="Materiales"><ul className="transfer-lines">{row.lines.map(line => <li key={line.stockItemId}>{qty(line.quantity)} {line.unit} · {line.name}{parts(line) && <small> ({parts(line)})</small>}
              {row.status !== "en_transito" && row.status !== "anulada" && (Number(line.damagedQty || 0) > 0 || Number(line.missingQty || 0) > 0) && <small className="below"> — llegaron {qty(Number(line.receivedQty || 0))}{line.damagedQty ? `, ${qty(line.damagedQty)} dañados` : ""}{line.missingQty ? `, faltaron ${qty(line.missingQty)}` : ""}{line.note ? ` · ${line.note}` : ""}</small>}</li>)}</ul></td>
            <td data-label="Estado"><span className={`badge transfer-${row.status}`}>{statusLabels[row.status]}</span></td>
            <td data-label="Recepción">{row.receivedAt ? <>{dateTime(row.receivedAt)}<small className="tracking-sub">{row.receivedByName}{row.receptionNote ? ` · ${row.receptionNote}` : ""}</small></> : "—"}</td>
            <td className="row-actions">
              <button className="row-action-wide" title="Remito en PDF" onClick={() => { void downloadRemitoPdf(remitoData(row)); }}><FileText size={15} /> Remito</button>
              {canEdit && row.status === "en_transito" && <button className="row-action-wide approve" onClick={() => setReceiving(row)}><PackageCheck size={15} /> Recibir</button>}
              {canEdit && row.status === "en_transito" && <button title="Anular: el material vuelve al origen" onClick={() => { void cancel(row); }}><Trash2 size={16} /></button>}
            </td>
          </tr>)}
        </tbody></table></div>}
    </section>
    {creating && <NewTransferModal onClose={() => setCreating(false)} onDone={transfer => { setCreating(false); setNotice(`Transferencia ${transfer.number} en camino a ${warehouseLabel(transfer.to)}.`); void downloadRemitoPdf(remitoData(transfer)).catch(() => {}); void load(); }} />}
    {receiving && <ReceiveTransferModal transfer={receiving} onClose={() => setReceiving(null)} onDone={transfer => { setReceiving(null); setNotice(`Transferencia ${transfer.number}: ${statusLabels[transfer.status].toLowerCase()}.`); void load(); }} />}
  </>;
}

function NewTransferModal({ onClose, onDone }: { onClose: () => void; onDone: (transfer: Transfer) => void }) {
  const [from, setFrom] = useState<WarehouseKey>("central");
  const [to, setTo] = useState<WarehouseKey>("salon");
  const [lines, setLines] = useState<Array<{ item: PickedItem; available: number; quantity: string }>>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function chooseFrom(value: WarehouseKey) {
    setFrom(value); setLines([]);
    if (value === to) setTo(WAREHOUSES.find(entry => entry.key !== value)!.key);
  }

  async function submit() {
    const body = { from, to, note, lines: lines.map(line => ({ itemId: line.item._id, quantity: Number(line.quantity.replace(",", ".")) || 0 })) };
    if (body.lines.some(line => line.quantity <= 0)) return setError("Poné la cantidad de cada material");
    setBusy(true); setError("");
    const response = await fetch("/api/transfers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setError(result.error || "No se pudo mandar la transferencia");
    onDone(result as Transfer);
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="new-transfer-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><ArrowRightLeft /></span><div>
        <p className="eyebrow">NUEVA TRANSFERENCIA</p><h2 id="new-transfer-title">Mandar material a otro depósito</h2>
        <small>Sale ahora del origen con su remito y queda en tránsito hasta que el destino confirme.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      {/* El form es para el espaciado de los modales; se confirma con el botón, no con Enter (el buscador usa Enter). */}
      <form onSubmit={event => event.preventDefault()}><div className="modal-form-body">
        <div className="form-grid">
          <label><span>Sale de *</span><select value={from} onChange={event => chooseFrom(event.target.value as WarehouseKey)}>{WAREHOUSES.map(entry => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>
          <label><span>Va a *</span><select value={to} onChange={event => setTo(event.target.value as WarehouseKey)}>{WAREHOUSES.filter(entry => entry.key !== from).map(entry => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>
          <label className="wide"><span>Observaciones</span><input value={note} onChange={event => setNote(event.target.value)} placeholder="Quién lo lleva, en qué vehículo…" /></label>
        </div>
        {lines.length > 0 && <table className="picked-lines"><thead><tr><th>Material</th><th>Hay en {warehouseLabel(from)}</th><th>Cantidad</th><th /></tr></thead><tbody>
          {lines.map((line, index) => <tr key={line.item._id}>
            <td>{line.item.name}</td><td>{qty(line.available)} {line.item.unit}</td>
            <td><input inputMode="decimal" value={line.quantity} onChange={event => setLines(current => current.map((row, position) => position === index ? { ...row, quantity: event.target.value.replace(/[^\d,.]/g, "") } : row))} /></td>
            <td><button type="button" className="icon-btn" onClick={() => setLines(current => current.filter((_, position) => position !== index))} aria-label="Sacar"><X size={15} /></button></td>
          </tr>)}
        </tbody></table>}
        <StockPicker warehouse={from} exclude={lines.map(line => line.item._id)} onPick={(item, available) => setLines(current => [...current, { item, available, quantity: "" }])} />
      </div>
      {error && <p className="form-error modal-error">{error}</p>}
      <footer><span>{lines.length} {lines.length === 1 ? "material" : "materiales"}</span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button type="button" className="primary-btn" disabled={busy || !lines.length} onClick={() => { void submit(); }}>{busy ? "Mandando…" : "Mandar y bajar el remito"}</button></footer></form>
    </section>
  </div>;
}

function ReceiveTransferModal({ transfer, onClose, onDone }: { transfer: Transfer; onClose: () => void; onDone: (transfer: Transfer) => void }) {
  const [lines, setLines] = useState(() => transfer.lines.map(line => ({ itemId: line.stockItemId, name: line.name, unit: line.unit, sent: line.quantity, received: String(line.quantity), damaged: "", note: "" })));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const number = (value: string) => Number(value.replace(",", ".")) || 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const over = lines.find(line => number(line.received) + number(line.damaged) > line.sent + 1e-9);
  const differences = lines.some(line => number(line.received) !== line.sent || number(line.damaged) > 0);

  async function submit() {
    if (over) return setError(`De ${over.name} se mandaron ${qty(over.sent)}: no pueden llegar más`);
    setBusy(true); setError("");
    const response = await fetch(`/api/transfers/${transfer._id}/receive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note, lines: lines.map(line => ({ itemId: line.itemId, receivedQty: number(line.received), damagedQty: number(line.damaged), note: line.note })) }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setError(result.error || "No se pudo confirmar la recepción");
    onDone(result as Transfer);
  }

  const set = (index: number, patch: Partial<(typeof lines)[number]>) => setLines(current => current.map((line, position) => position === index ? { ...line, ...patch } : line));

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="receive-transfer-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><PackageCheck /></span><div>
        <p className="eyebrow">TRANSFERENCIA {transfer.number}</p><h2 id="receive-transfer-title">Confirmar recepción en {warehouseLabel(transfer.to)}</h2>
        <small>Contá lo que llegó. Lo dañado queda como no utilizable y lo que falte, anotado.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      {/* El form es para el espaciado de los modales; se confirma con el botón, no con Enter (el buscador usa Enter). */}
      <form onSubmit={event => event.preventDefault()}><div className="modal-form-body">
        <table className="picked-lines"><thead><tr><th>Material</th><th>Se mandó</th><th>Llegó bien</th><th>Dañado</th><th>Observación</th></tr></thead><tbody>
          {lines.map((line, index) => <tr key={line.itemId} className={number(line.received) + number(line.damaged) > line.sent ? "row-alert" : ""}>
            <td>{line.name}</td><td>{qty(line.sent)} {line.unit}</td>
            <td><input inputMode="decimal" value={line.received} onChange={event => set(index, { received: event.target.value.replace(/[^\d,.]/g, "") })} /></td>
            <td><input inputMode="decimal" value={line.damaged} placeholder="0" onChange={event => set(index, { damaged: event.target.value.replace(/[^\d,.]/g, "") })} /></td>
            <td><input value={line.note} placeholder="Opcional" onChange={event => set(index, { note: event.target.value })} /></td>
          </tr>)}
        </tbody></table>
        <label className="wide"><span>Observaciones de la recepción</span><input value={note} onChange={event => setNote(event.target.value)} /></label>
      </div>
      {error && <p className="form-error modal-error">{error}</p>}
      <footer><span>{differences ? "Hay diferencias: quedan documentadas." : "Llegó todo bien."}</span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button type="button" className="primary-btn" disabled={busy} onClick={() => { void submit(); }}><Check size={16} /> {busy ? "Confirmando…" : "Confirmar recepción"}</button></footer></form>
    </section>
  </div>;
}
