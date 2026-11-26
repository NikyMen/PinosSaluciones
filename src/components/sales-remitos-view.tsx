"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, FileText, PackageOpen, Plus, Trash2, Truck, Undo2, X } from "lucide-react";
import { date, money, qty, todayIso } from "@/lib/format";
import { COMPANIES, COMPANY_KEYS, companyOf, type CompanyKey } from "@/lib/companies";
import { downloadRemitoPdf } from "@/lib/remito-pdf";
import { downloadShipmentPdf } from "@/lib/shipment-pdf";
import { DEFAULT_CARRIERS } from "@/components/shipments-view";
import { invoiceLabel } from "@/lib/invoice-labels";
import { invoicedQtyOf, remitoPendingCents } from "@/lib/remito-billing";
import { DateInput, MoneyInput, SearchSelect, type Option } from "@/components/fields";
import { StockPicker, type PickedItem } from "@/components/stock-picker";
import { fetchAllRecords } from "@/lib/fetch-all-records";
import { ThreadButton } from "@/components/document-thread";

type Line = { stockItemId: string; name: string; unit: string; quantity: number; unitPriceCents: number; totalCents: number; invoicedQty?: number };
type Remito = {
  _id: string; number: string; kind: "salida" | "devolucion"; company: CompanyKey; clientId: string; date: string; status: "pendiente" | "parcial" | "facturado" | "entregado" | "anulado";
  lines: Line[]; totalCents: number; note?: string; userName?: string; returnsId?: string;
  work?: { _id: string; code: string; name: string } | null; receiverName?: string;
  client: { name?: string; cuit?: string; address?: string } | null; invoices: Array<{ _id: string; number?: string; voucherType?: string; status?: string }>;
  // El envío por transporte vigente, si el remito salió por Correo, Mercado Libre o un expreso.
  shipment?: { _id: string; number: string; status: "despachado" | "con_guia"; carrier?: string; trackingNumber?: string } | null;
};

const filters = [
  { value: "pendiente", label: "Para facturar" }, { value: "facturado", label: "Facturados" },
  { value: "entregado", label: "Entregas a obra" }, { value: "devolucion", label: "Devoluciones" }, { value: "anulado", label: "Anulados" }, { value: "", label: "Todos" },
] as const;
const statusLabels = { pendiente: "Para facturar", parcial: "Facturado en parte", facturado: "Facturado", entregado: "Entregado a obra", anulado: "Anulado" };
/** Lo que todavía se puede facturar: lo pendiente y lo facturado en parte. */
const billable = (status: string) => status === "pendiente" || status === "parcial";

function pdfData(remito: Remito) {
  return {
    number: remito.number, date: remito.date, kind: remito.work ? "egreso" as const : remito.kind === "devolucion" ? "devolucion" as const : "venta" as const,
    fromWarehouse: "Salón de Ventas", destination: remito.work ? `${remito.work.code} · ${remito.work.name}` : remito.client?.name || "Cliente", receiverName: remito.receiverName,
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
  const [shipping, setShipping] = useState<Remito | null>(null);
  // El historial y otros links llegan con ?buscar=<número>: se muestra ese remito.
  const [only, setOnly] = useState("");
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("buscar");
    if (initial) { const timer = window.setTimeout(() => { setOnly(initial); setFilter(""); }, 0); return () => window.clearTimeout(timer); }
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/api/remitos");
    const body = await response.json();
    if (response.ok) setRows(body.items); else { setRows([]); setError(body.error || "No se pudieron leer los remitos"); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const visible = useMemo(() => (rows || []).filter(row => only ? row.number === only : filter === "" ? true : filter === "devolucion" ? row.kind === "devolucion" : row.kind === "salida" && (filter === "pendiente" ? billable(row.status) : row.status === filter)), [rows, filter, only]);
  const chosen = (rows || []).filter(row => selected.includes(row._id));
  // Los remitos con una factura A o B vigente: a su devolución le corresponde una nota de crédito.
  const creditable = useMemo(() => new Set((rows || []).filter(row => row.invoices.some(invoice => ["factura_a", "factura_b"].includes(String(invoice.voucherType)) && !["anulada", "sustituida"].includes(String(invoice.status)))).map(row => row._id)), [rows]);
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
      <p>Remitos del Salón de Ventas para clientes y obras. Las entregas a clientes se pueden facturar desde acá.</p>
    </div>{canEdit && <button className="primary-btn" onClick={() => setCreating(true)}><Plus size={18} /> Nuevo remito</button>}</div>
    <div className="toolbar">
      <div className="tracking-filter" role="group" aria-label="Estado">
        {filters.map(option => <button key={option.value} type="button" className={filter === option.value ? "active" : ""} onClick={() => { setFilter(option.value); setSelected([]); setOnly(""); }}>{option.label}</button>)}
      </div>
      {canInvoice && filter === "pendiente" && <button type="button" className="primary-btn" disabled={!chosen.length || mixed} title={mixed ? "Una factura junta remitos de un solo cliente y una sola empresa" : undefined}
        onClick={() => router.push(`/app/invoices?remitos=${selected.join(",")}`)}><FileCheck2 size={17} /> Facturar {chosen.length ? `${chosen.length} remito${chosen.length > 1 ? "s" : ""} · ${money(chosen.reduce((total, row) => total + remitoPendingCents(row), 0))}` : "seleccionados"}</button>}
    </div>
    {only && <div className="notice">Se muestra el remito {only}. <button type="button" className="link-btn" onClick={() => setOnly("")}>Ver todos</button></div>}
    {mixed && <div className="notice warning">Elegiste remitos de distintos clientes o empresas: una factura junta los de un solo cliente y una sola empresa.</div>}
    {error && <div className="notice error">{error}</div>}
    {notice && <div className="notice success" role="status">{notice}</div>}
    <section className="table-panel">
      {rows === null ? <div className="loading-state">Cargando…</div> : !visible.length ? <div className="empty-state"><p>No hay remitos en esta vista.</p></div>
        : <div className="table-scroll"><table><thead><tr>{filter === "pendiente" && canInvoice && <th />}<th>Remito</th><th>Fecha</th><th>Destino</th><th>Factura</th><th>Materiales</th><th>Total</th><th>Estado</th><th /></tr></thead><tbody>
          {visible.map(row => <tr key={row._id} className={selected.includes(row._id) ? "row-selected" : ""}>
            {filter === "pendiente" && canInvoice && <td><input type="checkbox" checked={selected.includes(row._id)} onChange={() => toggle(row)} aria-label={`Elegir ${row.number}`} /></td>}
            <td data-label="Remito"><b>{row.number}</b>{row.kind === "devolucion" && <small className="tracking-sub">Devolución</small>}</td>
            <td data-label="Fecha">{date(row.date)}</td>
            <td data-label="Destino">{row.work ? `${row.work.code} · ${row.work.name}` : row.client?.name || "—"}{row.receiverName && <small className="tracking-sub">Recibe {row.receiverName}</small>}</td>
            <td data-label="Factura"><span className={`company-badge ${row.company}`}>{companyOf(row.company).short}</span>{row.invoices.map(invoice => <small key={invoice._id} className="tracking-sub">{invoiceLabel(invoice)}</small>)}</td>
            <td data-label="Materiales"><ul className="transfer-lines">{row.lines.map(line => <li key={line.stockItemId}>{qty(line.quantity)} {line.unit} · {line.name}{row.status === "parcial" && invoicedQtyOf(line, row.status) > 0 ? ` (facturado ${qty(invoicedQtyOf(line, row.status))})` : ""}</li>)}</ul></td>
            <td data-label="Total">{money(row.totalCents)}{row.status === "parcial" && <small className="tracking-sub">Falta {money(remitoPendingCents(row))}</small>}</td>
            <td data-label="Estado">{row.kind === "devolucion" ? <span className="badge devolucion">Devolución</span> : <span className={`badge remito-${row.status}`}>{statusLabels[row.status]}</span>}
              {row.shipment && <small className="tracking-sub"><a href={`/app/envios?buscar=${encodeURIComponent(row.shipment.number)}`} title="Ver el envío por transporte">Enviado · {row.shipment.number}</a>{row.shipment.trackingNumber ? ` · guía ${row.shipment.trackingNumber}` : " · falta la guía"}</small>}</td>
            <td className="row-actions">
              <button className="row-action-wide" onClick={() => { void downloadRemitoPdf(pdfData(row)); }}><FileText size={15} /> PDF</button>
              <ThreadButton kind="sales_remito" id={row._id} />
              {(canEdit || canInvoice) && row.kind === "salida" && row.status !== "anulado" && !row.shipment && <button className="row-action-wide" title="Mandarlo por Correo Argentino, Mercado Libre o un expreso: hace el remito de envío con el valor declarado, sin volver a bajar el stock" onClick={() => setShipping(row)}><Truck size={15} /> Enviar por transporte</button>}
              {canEdit && row.kind === "salida" && row.status !== "anulado" && !row.work && <button className="row-action-wide" title="El cliente devuelve material: vuelve al Salón" onClick={() => setReturning(row)}><Undo2 size={15} /> Devolución</button>}
              {canInvoice && row.kind === "devolucion" && row.status !== "anulado" && creditable.has(String(row.returnsId || "")) && <button className="row-action-wide" title="Abre la nota de crédito de la factura de ese remito, con lo devuelto ya cargado" onClick={() => router.push(`/app/invoices?devolucion=${row._id}`)}><FileCheck2 size={15} /> Hacer nota de crédito</button>}
              {canEdit && row.kind === "salida" && ["pendiente", "entregado"].includes(row.status) && <button title="Anular: el material vuelve al Salón" onClick={() => { void cancel(row); }}><Trash2 size={16} /></button>}
            </td>
          </tr>)}
        </tbody></table></div>}
    </section>
    {creating && <NewRemitoModal onClose={() => setCreating(false)} onDone={remito => { setCreating(false); if (remito.work) setFilter("entregado"); setNotice(`Remito ${remito.number} emitido.`); void downloadRemitoPdf(pdfData(remito)).catch(() => {}); void load(); }} />}
    {shipping && <ShipSaleModal remito={shipping} onClose={() => setShipping(null)} onDone={shipment => { setShipping(null); setNotice(`Envío ${shipment.number} despachado con el remito ${shipping.number}. Cuando el transporte te dé la guía, cargala en Stock y logística › Envíos.`); void downloadShipmentPdf(shipment).catch(() => {}); void load(); }} />}
    {returning && <ReturnModal remito={returning} onClose={() => setReturning(null)} onDone={number => { setReturning(null); setFilter("devolucion"); setNotice(`Devolución ${number} registrada: el material volvió al Salón. Si el remito estaba facturado con A o B, falta la nota de crédito: está el botón "Hacer nota de crédito" en la devolución.`); void load(); }} />}
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
  const [destination, setDestination] = useState<"cliente" | "obra">("cliente");
  const [works, setWorks] = useState<Array<{ _id: string; code: string; name: string; status: string }>>([]);
  const [workId, setWorkId] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const toWork = destination === "obra";
  const [company, setCompany] = useState<CompanyKey>("tvp");
  // La cotización que entrega este remito, si la hay: queda habilitada para facturarlo.
  const [quotes, setQuotes] = useState<Array<{ _id: string; number: string; title: string; clientId: string; company?: CompanyKey; status: string }>>([]);
  const [quoteId, setQuoteId] = useState("");
  const [day, setDay] = useState(todayIso());
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Array<{ item: PickedItem; available: number; quantity: string; price: number; discount: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchAllRecords<{ _id: string; name: string; cuit?: string }>("clients").then(items => ({ items }))
      .then(result => setClients((result.items || []).map((client: { _id: string; name: string; cuit?: string }) => ({ value: client._id, label: client.name, hint: client.cuit }))));
    void fetchAllRecords<{ _id: string; number: string; title: string; clientId: string; company?: CompanyKey; status: string }>("quotes").then(setQuotes);
    void fetchAllRecords<{ _id: string; code: string; name: string; status: string }>("works").then(setWorks);
  }, []);
  const clientQuotes = quotes.filter(quote => quote.clientId === clientId && ["aprobada", "convertida"].includes(quote.status));

  const amount = (value: string) => Number(value.replace(",", ".")) || 0;
  // El neto de cada renglón: cantidad por precio, menos el descuento o bonificación en pesos.
  const lineCents = (line: { quantity: string; price: number; discount: number }) => Math.max(0, Math.round(amount(line.quantity) * line.price * 100) - Math.round(line.discount * 100));
  const total = lines.reduce((sum, line) => sum + lineCents(line), 0);

  async function submit() {
    if (toWork ? !workId || receiverName.trim().length < 2 : !clientId) return setError(toWork ? "Elegí la obra y completá quién recibe" : "Elegí el cliente");
    if (lines.some(line => amount(line.quantity) <= 0)) return setError("Poné la cantidad de cada material");
    const over = lines.find(line => amount(line.quantity) > line.available);
    if (over) return setError(`De ${over.item.name} hay ${qty(over.available)} en el Salón`);
    const overDiscount = lines.find(line => Math.round(line.discount * 100) > Math.round(amount(line.quantity) * line.price * 100));
    if (!toWork && overDiscount) return setError(`El descuento de ${overDiscount.item.name} pasa el importe del renglón`);
    setBusy(true); setError("");
    const response = await fetch("/api/remitos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      company, ...(toWork ? { workId, receiverName } : { clientId, quoteId }), date: day, note, lines: lines.map(line => ({ itemId: line.item._id, quantity: amount(line.quantity), unitPriceCents: Math.round(line.price * 100), discountCents: Math.round(line.discount * 100) })),
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
        <p className="eyebrow">NUEVO REMITO DE VENTA</p><h2 id="new-remito-title">Salida desde el Salón de Ventas</h2>
        <small>Descuenta el stock del Salón al emitir el remito.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      {/* El form es para el espaciado de los modales; se confirma con el botón, no con Enter (el buscador usa Enter). */}
      <form onSubmit={event => event.preventDefault()}><div className="modal-form-body">
        <div className="form-grid">
          <label><span>Destino *</span><select value={destination} onChange={event => setDestination(event.target.value as "cliente" | "obra")}><option value="cliente">Cliente</option><option value="obra">Obra</option></select></label>
          {toWork ? <>
            <label><span>Obra *</span><SearchSelect name="workId" value={workId} onChange={setWorkId} options={works.filter(row => !["cerrada", "cancelada"].includes(row.status)).map(row => ({ value: row._id, label: `${row.code} · ${row.name}` }))} /></label>
            <label><span>Nombre de quien recibe *</span><input value={receiverName} maxLength={100} onChange={event => setReceiverName(event.target.value)} /></label>
          </> : <>
          <label><span>Cliente *</span><SearchSelect name="clientId" options={clients} value={clientId} onChange={value => { setClientId(value); setQuoteId(""); }} placeholder="Elegí el cliente…" /></label>
          <label><span>Cotización<em className="field-hint">Si el remito entrega una cotización aprobada: la habilita para facturar</em></span>
            <SearchSelect name="quoteId" options={clientQuotes.map(quote => ({ value: quote._id, label: `${quote.number} — ${quote.title}` }))} value={quoteId}
              onChange={value => { setQuoteId(value); const quote = clientQuotes.find(candidate => candidate._id === value); if (quote?.company) setCompany(quote.company); }}
              placeholder={clientId ? clientQuotes.length ? "Sin cotización" : "El cliente no tiene cotizaciones aprobadas" : "Elegí primero el cliente"} /></label>
          </>}
          <label><span>{toWork ? "Empresa" : "Empresa que va a facturar"} *</span><select value={company} onChange={event => setCompany(event.target.value as CompanyKey)}>{COMPANY_KEYS.map(key => <option key={key} value={key}>{COMPANIES[key].legalName}</option>)}</select></label>
          <label><span>Fecha *</span><DateInput name="date" defaultValue={day} required recent onValueChange={setDay} /></label>
          <label><span>Observaciones</span><input value={note} onChange={event => setNote(event.target.value)} placeholder="Quién retira, entrega…" /></label>
        </div>
        {lines.length > 0 && <table className="picked-lines"><thead><tr><th>Material</th><th>En el Salón</th><th>Cantidad</th>{!toWork && <><th>Precio unitario (neto)</th><th>Descuento ($)</th><th>Subtotal</th></>}<th /></tr></thead><tbody>
          {lines.map((line, index) => <tr key={line.item._id} className={amount(line.quantity) > line.available ? "row-alert" : ""}>
            <td>{line.item.name}</td><td>{qty(line.available)} {line.item.unit}</td>
            <td><input inputMode="decimal" value={line.quantity} onChange={event => setLines(current => current.map((row, position) => position === index ? { ...row, quantity: event.target.value.replace(/[^\d,.]/g, "") } : row))} /></td>
            {!toWork && <><td><MoneyInput name={`price-${index}`} defaultValue={line.price} onValueChange={value => setLines(current => current.map((row, position) => position === index ? { ...row, price: value } : row))} /></td>
            <td><MoneyInput name={`discount-${index}`} defaultValue={line.discount} onValueChange={value => setLines(current => current.map((row, position) => position === index ? { ...row, discount: value } : row))} /></td>
            <td>{money(lineCents(line))}</td></>}
            <td><button type="button" className="icon-btn" onClick={() => setLines(current => current.filter((_, position) => position !== index))} aria-label="Sacar"><X size={15} /></button></td>
          </tr>)}
        </tbody></table>}
        <StockPicker warehouse="salon" exclude={lines.map(line => line.item._id)} onPick={(item, available) => setLines(current => [...current, { item, available, quantity: "", price: Number(item.salePriceCents || 0) / 100, discount: 0 }])} />
        <p className="invoice-note">Si el material está en el Galpón, primero se transfiere al Salón (Stock y logística &gt; Transferencias).</p>
      </div>
      {error && <p className="form-error modal-error">{error}</p>}
      <footer>{!toWork && <span>Total del remito <b>{money(total)}</b></span>}<button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button type="button" className="primary-btn" disabled={busy || !lines.length} onClick={() => { void submit(); }}>{busy ? "Emitiendo…" : "Emitir remito y bajar el PDF"}</button></footer></form>
    </section>
  </div>;
}

type SaleShipment = Parameters<typeof downloadShipmentPdf>[0];

/**
 * Mandar una venta por transporte: el remito de envío (ENV-n) con el valor
 * declarado, que arranca con el precio de cada renglón. No baja stock: el
 * remito de venta ya lo descontó.
 */
function ShipSaleModal({ remito, onClose, onDone }: { remito: Remito; onClose: () => void; onDone: (shipment: SaleShipment) => void }) {
  useEscape(onClose);
  // Un material que salió de los dos depósitos está en dos renglones: acá va junto.
  const merged = useMemo(() => {
    const byItem = new Map<string, { itemId: string; name: string; unit: string; quantity: number; totalCents: number }>();
    for (const line of remito.lines) {
      const entry = byItem.get(line.stockItemId);
      if (entry) { entry.quantity += line.quantity; entry.totalCents += Number(line.totalCents || 0); }
      else byItem.set(line.stockItemId, { itemId: line.stockItemId, name: line.name, unit: line.unit, quantity: line.quantity, totalCents: Number(line.totalCents || 0) });
    }
    return [...byItem.values()];
  }, [remito.lines]);
  const [destination, setDestination] = useState(() => remito.work ? `${remito.work.code} · ${remito.work.name}` : [remito.client?.address, remito.client?.name].filter(Boolean).join(" – "));
  const [receiver, setReceiver] = useState(remito.receiverName || remito.client?.name || "");
  const [carrier, setCarrier] = useState("");
  const [carriers, setCarriers] = useState<string[]>(DEFAULT_CARRIERS);
  const [packages, setPackages] = useState("");
  const [pallets, setPallets] = useState("");
  const [note, setNote] = useState("");
  const [unitCents, setUnitCents] = useState<Record<string, number>>(() => Object.fromEntries(merged.map(line => [line.itemId, line.quantity > 0 ? Math.round(line.totalCents / line.quantity) : 0])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Los transportes ya usados, para sugerirlos.
  useEffect(() => {
    let active = true;
    fetch("/api/shipments").then(response => response.ok ? response.json() : null).then(body => { if (active && body?.carriers) setCarriers([...new Set([...DEFAULT_CARRIERS, ...body.carriers as string[]])]); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const declared = merged.reduce((total, line) => total + Math.round(line.quantity * (unitCents[line.itemId] || 0)), 0);

  async function submit() {
    if (!destination.trim()) return setError("Poné a dónde va (la dirección del cliente o la sucursal del transporte)");
    if (!carrier.trim()) return setError("Poné el transporte");
    setBusy(true); setError("");
    const response = await fetch(`/api/remitos/${remito._id}/shipment`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      destination, receiver, carrier, packages: packages ? Number(packages) : undefined, pallets: pallets ? Number(pallets) : undefined, note,
      lines: merged.map(line => ({ itemId: line.itemId, declaredUnitCents: unitCents[line.itemId] || 0 })),
    }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setError(result.error || "No se pudo despachar el envío");
    onDone(result as SaleShipment);
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="ship-sale-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Truck /></span><div>
        <p className="eyebrow">REMITO {remito.number}</p><h2 id="ship-sale-title">Enviar por transporte</h2>
        <small>Hace el remito de envío con el valor declarado. No baja stock: el remito de venta ya lo descontó. Después cargás la guía en Envíos.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={event => event.preventDefault()}><div className="modal-form-body">
        <div className="form-grid">
          <label><span>Va a *<em className="field-hint">Dirección del cliente o sucursal donde lo deja el transporte</em></span><input value={destination} onChange={event => setDestination(event.target.value)} placeholder="Av. Siempre Viva 123 – Rosario" /></label>
          <label><span>Quién lo recibe o retira</span><input value={receiver} onChange={event => setReceiver(event.target.value)} /></label>
          <label><span>Transporte *</span><input list="ship-sale-carriers" autoFocus value={carrier} onChange={event => setCarrier(event.target.value)} placeholder="Correo Argentino" />
            <datalist id="ship-sale-carriers">{carriers.map(option => <option key={option} value={option} />)}</datalist></label>
          <label><span>Bultos y pallets<em className="field-hint">Opcional</em></span><div className="number-lock">
            <input inputMode="numeric" aria-label="Bultos" placeholder="Bultos" value={packages} onChange={event => setPackages(event.target.value.replace(/\D/g, ""))} />
            <input inputMode="numeric" aria-label="Pallets" placeholder="Pallets" value={pallets} onChange={event => setPallets(event.target.value.replace(/\D/g, ""))} />
          </div></label>
          <label className="wide"><span>Observaciones</span><input value={note} onChange={event => setNote(event.target.value)} placeholder="Salen en el remito de envío" /></label>
        </div>
        <table className="picked-lines"><thead><tr><th>Material</th><th>Cantidad</th><th>Precio unitario (valor declarado)</th><th>Subtotal</th></tr></thead><tbody>
          {merged.map((line, index) => <tr key={line.itemId}>
            <td>{line.name}</td><td>{qty(line.quantity)} {line.unit}</td>
            <td><MoneyInput name={`ship-declared-${index}`} defaultValue={(unitCents[line.itemId] || 0) / 100} onValueChange={value => setUnitCents(current => ({ ...current, [line.itemId]: Math.round(value * 100) }))} /></td>
            <td>{money(Math.round(line.quantity * (unitCents[line.itemId] || 0)))}</td>
          </tr>)}
        </tbody></table>
        <p className="invoice-note">Las cantidades son las del remito y no se cambian. El valor declarado arranca con el precio del remito.</p>
      </div>
      {error && <p className="form-error modal-error">{error}</p>}
      <footer><span>Valor declarado: <b>{money(declared)}</b></span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button type="button" className="primary-btn" disabled={busy} onClick={() => { void submit(); }}>{busy ? "Despachando…" : "Despachar y bajar el remito de envío"}</button></footer></form>
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
