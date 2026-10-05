"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, FileText, PackageOpen, Plus, Trash2, Undo2, X } from "lucide-react";
import { date, money, qty, todayIso } from "@/lib/format";
import { COMPANIES, COMPANY_KEYS, companyOf, type CompanyKey } from "@/lib/companies";
import { downloadRemitoPdf } from "@/lib/remito-pdf";
import { invoiceLabel } from "@/lib/invoice-labels";
import { DateInput, MoneyInput, SearchSelect, type Option } from "@/components/fields";
import { StockPicker, type PickedItem } from "@/components/stock-picker";
import { fetchAllRecords } from "@/lib/fetch-all-records";

type Line = { stockItemId: string; name: string; unit: string; quantity: number; unitPriceCents: number; totalCents: number };
type Remito = {
  _id: string; number: string; kind: "salida" | "devolucion"; company: CompanyKey; clientId: string; date: string; status: "pendiente" | "facturado" | "anulado";
  lines: Line[]; totalCents: number; note?: string; userName?: string; returnsId?: string;
  client: { name?: string; cuit?: string } | null; invoices: Array<{ _id: string; number?: string; voucherType?: string; status?: string }>;
};

const filters = [
  { value: "pendiente", label: "Para facturar" }, { value: "facturado", label: "Facturados" },
  { value: "devolucion", label: "Devoluciones" }, { value: "anulado", label: "Anulados" }, { value: "", label: "Todos" },
] as const;
const statusLabels = { pendiente: "Para facturar", facturado: "Facturado", anulado: "Anulado" };

function pdfData(remito: Remito) {
  return {
    number: remito.number, date: remito.date, kind: remito.kind === "devolucion" ? "devolucion" as const : "venta" as const,
    fromWarehouse: "Salón de Ventas", destination: remito.client?.name || "Cliente",
    items: remito.lines.map(line => ({ name: line.name, unit: line.unit, quantity: line.quantity })), note: remito.note, userName: remito.userName,
  };
}

/**
 * Remitos de venta: la salida al cliente desde el Salón de Ventas. Descuentan
 * el stock; después se eligen los de un mismo cliente y empresa y se facturan
 * juntos (A, B o X) sin volver a descontar.
 */
export function SalesRemitosView({ canEdit, canInvoice }: { canEdit: boolean; canInvoice: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Remito[] | null>(null);
  const [filter, setFilter] = useState<(typeof filters)[number]["value"]>("pendiente");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [returning, setReturning] = useState<Remito | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/remitos");
    const body = await response.json();
    if (response.ok) setRows(body.items); else { setRows([]); setError(body.error || "No se pudieron leer los remitos"); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const visible = useMemo(() => (rows || []).filter(row => filter === "" ? true : filter === "devolucion" ? row.kind === "devolucion" : row.kind === "salida" && row.status === filter), [rows, filter]);
  const chosen = (rows || []).filter(row => selected.includes(row._id));
  const mixed = new Set(chosen.map(row => `${row.clientId}-${row.company}`)).size > 1;

  function toggle(row: Remito) {
    setSelected(current => current.includes(row._id) ? current.filter(id => id !== row._id) : [...current, row._id]);
  }

  async function cancel(row: Remito) {
    const reason = prompt(`¿Por qué se anula el remito ${row.number}? El material vuelve al Salón de Ventas.`);
    if (!reason) return;
    const response = await fetch(`/api/remitos/${row._id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
    const body = await response.json();
    if (!response.ok) return setError(body.error || "No se pudo anular");
    setNotice(`Remito ${row.number} anulado: el material volvió al Salón.`);
    void load();
  }

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">VENTAS</p>
      <h1>Remitos de venta</h1>
      <p>La salida al cliente desde el Salón de Ventas: es lo que descuenta el stock. La factura después referencia uno o varios remitos del mismo cliente y no vuelve a descontar.</p>
    </div>{canEdit && <button className="primary-btn" onClick={() => setCreating(true)}><Plus size={18} /> Nuevo remito</button>}</div>
    <div className="toolbar">
      <div className="tracking-filter" role="group" aria-label="Estado">
        {filters.map(option => <button key={option.value} type="button" className={filter === option.value ? "active" : ""} onClick={() => { setFilter(option.value); setSelected([]); }}>{option.label}</button>)}
      </div>
      {canInvoice && filter === "pendiente" && <button type="button" className="primary-btn" disabled={!chosen.length || mixed} title={mixed ? "Una factura junta remitos de un solo cliente y una sola empresa" : undefined}
        onClick={() => router.push(`/app/invoices?remitos=${selected.join(",")}`)}><FileCheck2 size={17} /> Facturar {chosen.length ? `${chosen.length} remito${chosen.length > 1 ? "s" : ""} · ${money(chosen.reduce((total, row) => total + row.totalCents, 0))}` : "seleccionados"}</button>}
    </div>
    {mixed && <div className="notice warning">Elegiste remitos de distintos clientes o empresas: una factura junta los de un solo cliente y una sola empresa.</div>}
    {error && <div className="notice error">{error}</div>}
    {notice && <div className="notice success" role="status">{notice}</div>}
    <section className="table-panel">
      {rows === null ? <div className="loading-state">Cargando…</div> : !visible.length ? <div className="empty-state"><p>No hay remitos en esta vista.</p></div>
        : <div className="table-scroll"><table><thead><tr>{filter === "pendiente" && canInvoice && <th />}<th>Remito</th><th>Fecha</th><th>Cliente</th><th>Factura</th><th>Materiales</th><th>Total</th><th>Estado</th><th /></tr></thead><tbody>
          {visible.map(row => <tr key={row._id} className={selected.includes(row._id) ? "row-selected" : ""}>
            {filter === "pendiente" && canInvoice && <td><input type="checkbox" checked={selected.includes(row._id)} onChange={() => toggle(row)} aria-label={`Elegir ${row.number}`} /></td>}
            <td data-label="Remito"><b>{row.number}</b>{row.kind === "devolucion" && <small className="tracking-sub">Devolución</small>}</td>
            <td data-label="Fecha">{date(row.date)}</td>
            <td data-label="Cliente">{row.client?.name || "—"}</td>
            <td data-label="Factura"><span className={`company-badge ${row.company}`}>{companyOf(row.company).short}</span>{row.invoices.map(invoice => <small key={invoice._id} className="tracking-sub">{invoiceLabel(invoice)}</small>)}</td>
            <td data-label="Materiales"><ul className="transfer-lines">{row.lines.map(line => <li key={line.stockItemId}>{qty(line.quantity)} {line.unit} · {line.name}</li>)}</ul></td>
            <td data-label="Total">{money(row.totalCents)}</td>
            <td data-label="Estado">{row.kind === "devolucion" ? <span className="badge devolucion">Devolución</span> : <span className={`badge remito-${row.status}`}>{statusLabels[row.status]}</span>}</td>
            <td className="row-actions">
              <button className="row-action-wide" onClick={() => { void downloadRemitoPdf(pdfData(row)); }}><FileText size={15} /> PDF</button>
              {canEdit && row.kind === "salida" && row.status !== "anulado" && <button className="row-action-wide" title="El cliente devuelve material: vuelve al Salón" onClick={() => setReturning(row)}><Undo2 size={15} /> Devolución</button>}
              {canEdit && row.kind === "salida" && row.status === "pendiente" && <button title="Anular: el material vuelve al Salón" onClick={() => { void cancel(row); }}><Trash2 size={16} /></button>}
            </td>
          </tr>)}
        </tbody></table></div>}
    </section>
    {creating && <NewRemitoModal onClose={() => setCreating(false)} onDone={remito => { setCreating(false); setNotice(`Remito ${remito.number} emitido.`); void downloadRemitoPdf(pdfData(remito)).catch(() => {}); void load(); }} />}
    {returning && <ReturnModal remito={returning} onClose={() => setReturning(null)} onDone={number => { setReturning(null); setNotice(`Devolución ${number} registrada: el material volvió al Salón. Si corresponde, falta la nota de crédito.`); void load(); }} />}
  </>;
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
}

function NewRemitoModal({ onClose, onDone }: { onClose: () => void; onDone: (remito: Remito) => void }) {
  useEscape(onClose);
  const [clients, setClients] = useState<Option[]>([]);
  const [clientId, setClientId] = useState("");
  const [company, setCompany] = useState<CompanyKey>("tvp");
  const [day, setDay] = useState(todayIso());
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Array<{ item: PickedItem; available: number; quantity: string; price: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchAllRecords<{ _id: string; name: string; cuit?: string }>("clients").then(items => ({ items }))
      .then(result => setClients((result.items || []).map((client: { _id: string; name: string; cuit?: string }) => ({ value: client._id, label: client.name, hint: client.cuit }))));
  }, []);

  const amount = (value: string) => Number(value.replace(",", ".")) || 0;
  const total = lines.reduce((sum, line) => sum + Math.round(amount(line.quantity) * line.price * 100), 0);

  async function submit() {
    if (!clientId) return setError("Elegí el cliente");
    if (lines.some(line => amount(line.quantity) <= 0)) return setError("Poné la cantidad de cada material");
    const over = lines.find(line => amount(line.quantity) > line.available);
    if (over) return setError(`De ${over.item.name} hay ${qty(over.available)} en el Salón`);
    setBusy(true); setError("");
    const response = await fetch("/api/remitos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      company, clientId, date: day, note, lines: lines.map(line => ({ itemId: line.item._id, quantity: amount(line.quantity), unitPriceCents: Math.round(line.price * 100) })),
    }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setError(result.error || "No se pudo emitir el remito");
    onDone({ ...result, client: { name: clients.find(client => client.value === clientId)?.label }, invoices: [] } as Remito);
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="new-remito-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><PackageOpen /></span><div>
        <p className="eyebrow">NUEVO REMITO DE VENTA</p><h2 id="new-remito-title">Salida al cliente desde el Salón</h2>
        <small>Descuenta el stock del Salón de Ventas. La factura se hace después, referenciando el remito.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      {/* El form es para el espaciado de los modales; se confirma con el botón, no con Enter (el buscador usa Enter). */}
      <form onSubmit={event => event.preventDefault()}><div className="modal-form-body">
        <div className="form-grid">
          <label><span>Cliente *</span><SearchSelect name="clientId" options={clients} value={clientId} onChange={setClientId} placeholder="Elegí el cliente…" /></label>
          <label><span>Empresa que va a facturar *</span><select value={company} onChange={event => setCompany(event.target.value as CompanyKey)}>{COMPANY_KEYS.map(key => <option key={key} value={key}>{COMPANIES[key].legalName}</option>)}</select></label>
          <label><span>Fecha *</span><DateInput name="date" defaultValue={day} required recent onValueChange={setDay} /></label>
          <label><span>Observaciones</span><input value={note} onChange={event => setNote(event.target.value)} placeholder="Quién retira, entrega…" /></label>
        </div>
        {lines.length > 0 && <table className="picked-lines"><thead><tr><th>Material</th><th>En el Salón</th><th>Cantidad</th><th>Precio unitario (neto)</th><th>Subtotal</th><th /></tr></thead><tbody>
          {lines.map((line, index) => <tr key={line.item._id} className={amount(line.quantity) > line.available ? "row-alert" : ""}>
            <td>{line.item.name}</td><td>{qty(line.available)} {line.item.unit}</td>
            <td><input inputMode="decimal" value={line.quantity} onChange={event => setLines(current => current.map((row, position) => position === index ? { ...row, quantity: event.target.value.replace(/[^\d,.]/g, "") } : row))} /></td>
            <td><MoneyInput name={`price-${index}`} defaultValue={line.price} onValueChange={value => setLines(current => current.map((row, position) => position === index ? { ...row, price: value } : row))} /></td>
            <td>{money(Math.round(amount(line.quantity) * line.price * 100))}</td>
            <td><button type="button" className="icon-btn" onClick={() => setLines(current => current.filter((_, position) => position !== index))} aria-label="Sacar"><X size={15} /></button></td>
          </tr>)}
        </tbody></table>}
        <StockPicker warehouse="salon" exclude={lines.map(line => line.item._id)} onPick={(item, available) => setLines(current => [...current, { item, available, quantity: "", price: Number(item.lastPriceCents || 0) / 100 }])} />
        <p className="invoice-note">Si el material está en el Depósito Central, primero se transfiere al Salón (Stock y logística &gt; Transferencias).</p>
      </div>
      {error && <p className="form-error modal-error">{error}</p>}
      <footer><span>Total del remito: <b>{money(total)}</b></span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button type="button" className="primary-btn" disabled={busy || !lines.length} onClick={() => { void submit(); }}>{busy ? "Emitiendo…" : "Emitir remito y bajar el PDF"}</button></footer></form>
    </section>
  </div>;
}

function ReturnModal({ remito, onClose, onDone }: { remito: Remito; onClose: () => void; onDone: (number: string) => void }) {
  useEscape(onClose);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const lines = Object.entries(quantities).map(([itemId, value]) => ({ itemId, quantity: Number(value.replace(",", ".")) || 0 })).filter(line => line.quantity > 0);
    if (!lines.length) return setError("Poné cuánto devuelve de cada material");
    setBusy(true); setError("");
    const response = await fetch(`/api/remitos/${remito._id}/return`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines, note, date: todayIso() }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setError(result.error || "No se pudo registrar la devolución");
    onDone(result.number);
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="return-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Undo2 /></span><div>
        <p className="eyebrow">REMITO {remito.number}</p><h2 id="return-title">Devolución del cliente</h2>
        <small>Queda un remito de entrada y el material vuelve al Salón de Ventas. Si ya estaba facturado, después va la nota de crédito.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      {/* El form es para el espaciado de los modales; se confirma con el botón, no con Enter (el buscador usa Enter). */}
      <form onSubmit={event => event.preventDefault()}><div className="modal-form-body">
        <table className="picked-lines"><thead><tr><th>Material</th><th>Se entregó</th><th>Devuelve</th></tr></thead><tbody>
          {remito.lines.map(line => <tr key={line.stockItemId}><td>{line.name}</td><td>{qty(line.quantity)} {line.unit}</td>
            <td><input inputMode="decimal" value={quantities[line.stockItemId] || ""} placeholder="0" onChange={event => setQuantities(current => ({ ...current, [line.stockItemId]: event.target.value.replace(/[^\d,.]/g, "") }))} /></td></tr>)}
        </tbody></table>
        <label className="wide"><span>Motivo</span><input value={note} onChange={event => setNote(event.target.value)} /></label>
      </div>
      {error && <p className="form-error modal-error">{error}</p>}
      <footer><span>Queda auditado.</span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button type="button" className="primary-btn" disabled={busy} onClick={() => { void submit(); }}>{busy ? "Registrando…" : "Registrar devolución"}</button></footer></form>
    </section>
  </div>;
}
