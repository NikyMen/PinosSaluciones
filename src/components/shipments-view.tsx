"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Paperclip, Plus, Trash2, Truck, X } from "lucide-react";
import { dateTime, money, qty } from "@/lib/format";
import { WAREHOUSES, warehouseLabel, type WarehouseKey } from "@/lib/warehouses";
import { COMPANIES, COMPANY_KEYS, type CompanyKey } from "@/lib/companies";
import { downloadShipmentPdf, type ShipmentPdfData } from "@/lib/shipment-pdf";
import { MoneyInput, SearchSelect } from "@/components/fields";
import { StockPicker, type PickedItem } from "@/components/stock-picker";

type Line = { stockItemId: string; name: string; code?: string; unit: string; quantity: number; declaredUnitCents: number; declaredCents: number };
type Shipment = {
  _id: string; number: string; company?: CompanyKey; from: WarehouseKey; destination: string; receiver?: string; carrier: string; packages?: number; pallets?: number;
  workId?: string; note?: string; lines: Line[]; declaredCents: number; status: "despachado" | "con_guia" | "anulado"; sentAt: string; sentByName?: string;
  trackingNumber?: string; trackingFiles?: Array<{ path: string; name?: string }>; trackingAt?: string; trackingByName?: string; cancelReason?: string;
};

const statusLabels: Record<Shipment["status"], string> = { despachado: "Despachado, falta la guía", con_guia: "Con guía", anulado: "Anulado" };
const statusClass: Record<Shipment["status"], string> = { despachado: "transfer-en_transito", con_guia: "transfer-recibida", anulado: "" };
const DEFAULT_CARRIERS = ["Expreso Demonte", "Correo Argentino", "Mercado Libre (Mercado Envíos)"];

function pdfData(shipment: Shipment, workLabel?: string): ShipmentPdfData {
  return { ...shipment, workLabel, lines: shipment.lines };
}

async function upload(file: File) {
  const form = new FormData(); form.set("file", file);
  const response = await fetch("/api/uploads", { method: "POST", body: form });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo subir el archivo");
  return { path: String(body.path), name: String(body.name || file.name) };
}

/**
 * Envíos por transporte (encomiendas): sale del depósito con su remito y el
 * valor declarado, nadie confirma la llegada y después se carga la guía.
 */
export function ShipmentsView({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Shipment[] | null>(null);
  const [workLabels, setWorkLabels] = useState<Record<string, string>>({});
  const [carriers, setCarriers] = useState<string[]>([]);
  const [destinations, setDestinations] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [tracking, setTracking] = useState<Shipment | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/shipments");
    const body = await response.json();
    if (!response.ok) { setRows([]); setError(body.error || "No se pudieron leer los envíos"); return; }
    setRows(body.items); setWorkLabels(body.workLabels || {}); setCarriers(body.carriers || []); setDestinations(body.destinations || []);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function cancel(shipment: Shipment) {
    const reason = prompt(`¿Por qué se anula el envío ${shipment.number}? El material vuelve al ${warehouseLabel(shipment.from)}.`);
    if (!reason) return;
    const response = await fetch(`/api/shipments/${shipment._id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
    const body = await response.json();
    if (!response.ok) return setError(body.error || "No se pudo anular");
    setNotice(`Envío ${shipment.number} anulado: el material volvió al ${warehouseLabel(shipment.from)}.`);
    void load();
  }

  const missing = (rows || []).filter(row => row.status === "despachado");

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">STOCK Y LOGÍSTICA</p>
      <h1>Envíos por transporte</h1>
      <p>Encomiendas que salen por un transporte (Expreso Demonte, Correo Argentino, Mercado Libre). Sale con remito y valor declarado, nadie confirma la llegada y después se carga la guía.</p>
    </div>{canEdit && <button className="primary-btn" onClick={() => setCreating(true)}><Plus size={18} /> Nuevo envío</button>}</div>
    {error && <div className="notice error">{error}</div>}
    {notice && <div className="notice success" role="status">{notice}</div>}
    {missing.length > 0 && <div className="notice warning">{missing.length} {missing.length === 1 ? "envío no tiene" : "envíos no tienen"} cargada la guía del transporte.</div>}
    <section className="table-panel">
      {rows === null ? <div className="loading-state">Cargando…</div> : !rows.length ? <div className="empty-state"><p>Todavía no hay envíos.</p></div>
        : <div className="table-scroll"><table><thead><tr><th>Remito</th><th>Salió</th><th>Destino</th><th>Transporte</th><th>Materiales</th><th>Valor declarado</th><th>Estado</th><th /></tr></thead><tbody>
          {rows.map(row => <tr key={row._id}>
            <td data-label="Remito"><b>{row.number}</b></td>
            <td data-label="Salió">{dateTime(row.sentAt)}<small className="tracking-sub">{row.sentByName} · {warehouseLabel(row.from)}</small></td>
            <td data-label="Destino">{row.destination}{(row.receiver || (row.workId && workLabels[row.workId])) && <small className="tracking-sub">{[row.receiver, row.workId && workLabels[row.workId] ? `Obra ${workLabels[row.workId]}` : ""].filter(Boolean).join(" · ")}</small>}</td>
            <td data-label="Transporte">{row.carrier}<small className="tracking-sub">{[row.packages ? `${row.packages} bultos` : "", row.pallets ? `${row.pallets} pallets` : ""].filter(Boolean).join(" · ")}</small></td>
            <td data-label="Materiales"><ul className="transfer-lines">{row.lines.map(line => <li key={line.stockItemId}>{qty(line.quantity)} {line.unit} · {line.name}</li>)}</ul></td>
            <td data-label="Valor declarado">{money(row.declaredCents)}</td>
            <td data-label="Estado"><span className={`badge ${statusClass[row.status]}`}>{statusLabels[row.status]}</span>
              {row.trackingNumber && <small className="tracking-sub">Guía {row.trackingNumber}{row.trackingFiles?.map(file => <span key={file.path}> · <a href={file.path} target="_blank" rel="noreferrer">{file.name || "archivo"}</a></span>)}</small>}
              {row.status === "anulado" && row.cancelReason && <small className="tracking-sub">{row.cancelReason}</small>}</td>
            <td className="row-actions">
              <button className="row-action-wide" title="Remito de envío en PDF" onClick={() => { void downloadShipmentPdf(pdfData(row, row.workId ? workLabels[row.workId] : undefined)); }}><FileText size={15} /> Remito</button>
              {canEdit && row.status !== "anulado" && <button className={`row-action-wide${row.status === "despachado" ? " approve" : ""}`} onClick={() => setTracking(row)}><Paperclip size={15} /> {row.status === "despachado" ? "Cargar guía" : "Cambiar guía"}</button>}
              {canEdit && row.status === "despachado" && <button title="Anular: el material vuelve al depósito" onClick={() => { void cancel(row); }}><Trash2 size={16} /></button>}
            </td>
          </tr>)}
        </tbody></table></div>}
    </section>
    {creating && <NewShipmentModal carriers={[...new Set([...DEFAULT_CARRIERS, ...carriers])]} destinations={destinations} onClose={() => setCreating(false)}
      onDone={(shipment, workLabel) => { setCreating(false); setNotice(`Envío ${shipment.number} despachado. Cuando el transporte te dé la guía, cargala con "Cargar guía".`); void downloadShipmentPdf(pdfData(shipment, workLabel)).catch(() => {}); void load(); }} />}
    {tracking && <TrackingModal shipment={tracking} onClose={() => setTracking(null)} onDone={shipment => { setTracking(null); setNotice(`Envío ${shipment.number}: guía ${shipment.trackingNumber} cargada.`); void load(); }} />}
  </>;
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
}

function NewShipmentModal({ carriers, destinations, onClose, onDone }: { carriers: string[]; destinations: string[]; onClose: () => void; onDone: (shipment: Shipment, workLabel?: string) => void }) {
  const [company, setCompany] = useState<CompanyKey>("tvp");
  const [from, setFrom] = useState<WarehouseKey>("central");
  const [destination, setDestination] = useState("");
  const [receiver, setReceiver] = useState("");
  const [carrier, setCarrier] = useState("");
  const [packages, setPackages] = useState("");
  const [pallets, setPallets] = useState("");
  const [workId, setWorkId] = useState("");
  const [works, setWorks] = useState<Array<{ value: string; label: string }>>([]);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Array<{ item: PickedItem; available: number; quantity: string; unitCents: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEscape(onClose);

  // Las obras, por si el envío es para una: el costo se le carga.
  useEffect(() => {
    let active = true;
    void (async () => {
      const found: Array<{ value: string; label: string }> = [];
      for (let page = 1; page <= 5; page++) {
        const response = await fetch(`/api/records/works?limit=100&page=${page}`).catch(() => null);
        if (!response?.ok) break;
        const body = await response.json();
        for (const work of body.items || []) found.push({ value: String(work._id), label: [work.code, work.name].filter(Boolean).join(" · ") });
        if (page >= Number(body.pagination?.pages || 1)) break;
      }
      if (active) setWorks(found);
    })();
    return () => { active = false; };
  }, []);

  const number = (value: string) => Number(value.replace(",", ".")) || 0;
  const declared = lines.reduce((total, line) => total + Math.round(number(line.quantity) * line.unitCents), 0);

  function chooseFrom(value: WarehouseKey) { setFrom(value); setLines([]); }

  async function submit() {
    if (!destination.trim()) return setError("Poné a dónde va (por ejemplo: Depósito Demonte – Rosario)");
    if (!carrier.trim()) return setError("Poné el transporte");
    if (lines.some(line => number(line.quantity) <= 0)) return setError("Poné la cantidad de cada material");
    const over = lines.find(line => number(line.quantity) > line.available + 1e-9);
    if (over) return setError(`De ${over.item.name} hay ${qty(over.available)} ${over.item.unit} en ${warehouseLabel(from)}`);
    setBusy(true); setError("");
    const body = {
      company, from, destination, receiver, carrier, packages: packages ? number(packages) : undefined, pallets: pallets ? number(pallets) : undefined, workId, note,
      lines: lines.map(line => ({ itemId: line.item._id, quantity: number(line.quantity), declaredUnitCents: line.unitCents })),
    };
    const response = await fetch("/api/shipments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setError(result.error || "No se pudo despachar el envío");
    onDone(result as Shipment, works.find(work => work.value === workId)?.label);
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="new-shipment-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Truck /></span><div>
        <p className="eyebrow">NUEVO ENVÍO</p><h2 id="new-shipment-title">Mandar material por transporte</h2>
        <small>Sale ahora del depósito con su remito y el valor declarado. Nadie confirma la llegada: después cargás la guía.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      {/* Se confirma con el botón, no con Enter (el buscador de materiales usa Enter). */}
      <form onSubmit={event => event.preventDefault()}><div className="modal-form-body">
        <div className="form-grid">
          <label><span>Empresa que envía *<em className="field-hint">Sale en el encabezado del remito</em></span><select value={company} onChange={event => setCompany(event.target.value as CompanyKey)}>{COMPANY_KEYS.map(key => <option key={key} value={key}>{COMPANIES[key].legalName}</option>)}</select></label>
          <label><span>Sale de *</span><select value={from} onChange={event => chooseFrom(event.target.value as WarehouseKey)}>{WAREHOUSES.map(entry => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>
          <label><span>Va a *<em className="field-hint">Ciudad y lugar donde lo deja el transporte</em></span><input list="shipment-destinations" value={destination} onChange={event => setDestination(event.target.value)} placeholder="Depósito Demonte – Rosario" />
            <datalist id="shipment-destinations">{destinations.map(option => <option key={option} value={option} />)}</datalist></label>
          <label><span>Quién lo recibe o retira</span><input value={receiver} onChange={event => setReceiver(event.target.value)} placeholder="Opcional: transporte local, cliente…" /></label>
          <label><span>Transporte *</span><input list="shipment-carriers" value={carrier} onChange={event => setCarrier(event.target.value)} placeholder="Expreso Demonte" />
            <datalist id="shipment-carriers">{carriers.map(option => <option key={option} value={option} />)}</datalist></label>
          <label><span>Bultos y pallets<em className="field-hint">Opcional</em></span><div className="number-lock">
            <input inputMode="numeric" aria-label="Bultos" placeholder="Bultos" value={packages} onChange={event => setPackages(event.target.value.replace(/\D/g, ""))} />
            <input inputMode="numeric" aria-label="Pallets" placeholder="Pallets" value={pallets} onChange={event => setPallets(event.target.value.replace(/\D/g, ""))} />
          </div></label>
          <label><span>Obra<em className="field-hint">Opcional: si es para una obra, el costo se le carga</em></span><SearchSelect name="workId" value={workId} onChange={setWorkId} options={works} placeholder="Sin obra" /></label>
          <label><span>Observaciones</span><input value={note} onChange={event => setNote(event.target.value)} placeholder="Salen en el remito" /></label>
        </div>
        {lines.length > 0 && <table className="picked-lines"><thead><tr><th>Material</th><th>Hay en {warehouseLabel(from)}</th><th>Cantidad</th><th>Precio unitario (valor declarado)</th><th>Subtotal</th><th /></tr></thead><tbody>
          {lines.map((line, index) => <tr key={line.item._id}>
            <td>{line.item.name}</td><td>{qty(line.available)} {line.item.unit}</td>
            <td><input inputMode="decimal" value={line.quantity} onChange={event => setLines(current => current.map((row, position) => position === index ? { ...row, quantity: event.target.value.replace(/[^\d,.]/g, "") } : row))} /></td>
            <td><MoneyInput name={`declared-${index}`} defaultValue={line.unitCents / 100} onValueChange={value => setLines(current => current.map((row, position) => position === index ? { ...row, unitCents: Math.round(value * 100) } : row))} /></td>
            <td>{money(Math.round(number(line.quantity) * line.unitCents))}</td>
            <td><button type="button" className="icon-btn" onClick={() => setLines(current => current.filter((_, position) => position !== index))} aria-label="Sacar"><X size={15} /></button></td>
          </tr>)}
        </tbody></table>}
        <StockPicker warehouse={from} exclude={lines.map(line => line.item._id)}
          onPick={(item, available) => setLines(current => [...current, { item, available, quantity: "", unitCents: Number(item.avgCostCents || item.lastPriceCents || 0) }])} />
      </div>
      {error && <p className="form-error modal-error">{error}</p>}
      <footer><span>Valor declarado: <b>{money(declared)}</b></span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button type="button" className="primary-btn" disabled={busy || !lines.length} onClick={() => { void submit(); }}>{busy ? "Despachando…" : "Despachar y bajar el remito"}</button></footer></form>
    </section>
  </div>;
}

function TrackingModal({ shipment, onClose, onDone }: { shipment: Shipment; onClose: () => void; onDone: (shipment: Shipment) => void }) {
  const [trackingNumber, setTrackingNumber] = useState(shipment.trackingNumber || "");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEscape(onClose);

  async function submit() {
    if (!trackingNumber.trim()) return setError("Poné el N° de guía o de remito que te dio el transporte");
    setBusy(true); setError("");
    try {
      const uploaded = await Promise.all(files.map(upload));
      const response = await fetch(`/api/shipments/${shipment._id}/tracking`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trackingNumber, files: uploaded }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo guardar la guía");
      onDone(result as Shipment);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "No se pudo guardar la guía"); }
    finally { setBusy(false); }
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="tracking-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Paperclip /></span><div>
        <p className="eyebrow">ENVÍO {shipment.number}</p><h2 id="tracking-title">Guía del transporte</h2>
        <small>El número de guía o de remito que te dio {shipment.carrier}, y si querés una foto o el PDF.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="modal-form-body"><div className="form-grid">
        <label><span>N° de guía o remito del transporte *</span><input autoFocus value={trackingNumber} onChange={event => setTrackingNumber(event.target.value)} /></label>
        <label><span>Foto o PDF<em className="field-hint">Opcional</em></span><input type="file" multiple accept="image/*,application/pdf" onChange={event => setFiles([...(event.target.files || [])])} /></label>
      </div></div>
      {error && <p className="form-error modal-error">{error}</p>}
      <footer><span /><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={busy}>{busy ? "Guardando…" : "Guardar la guía"}</button></footer></form>
    </section>
  </div>;
}
