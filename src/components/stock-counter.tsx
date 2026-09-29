"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Camera, Check, FileText, HardHat, Minus, PackagePlus, Plus, Printer, ScanBarcode, Search, Tag, Trash2, TriangleAlert, X } from "lucide-react";
import { DateInput, SearchSelect, type Option } from "@/components/fields";
import { CameraScanner, scanFeedback, useKeyboardScanner } from "@/components/barcode-scanner";
import { amountToInput, dateTime, money, parseAmount, qty, todayIso } from "@/lib/format";
import { levelsOf, splitDelivery, totalOf } from "@/lib/stock-levels";
import { WAREHOUSES, warehouseLabel, type WarehouseKey } from "@/lib/warehouses";
import { downloadRemitoPdf, type RemitoData } from "@/lib/remito-pdf";
import { printLabels, printTicket, readPrinterSettings, savePrinterSettings, type PrinterSettings, type TicketData } from "@/lib/ticket-print";
import { cleanScannedCode } from "@/lib/barcode";

/* ─────────────────────────────────────────────────────────────────────────────
   Caja del depósito: lo que entra y lo que sale, escaneando.

   Se escanea con el lector de mano (escribe como un teclado y aprieta Enter),
   con la cámara del celular, o se busca por nombre. Cada lectura suma una
   unidad; la cantidad se corrige en la lista. Al confirmar, todo entra o sale
   junto con un solo comprobante (CJ-…) que se imprime en la ticketera.
   ───────────────────────────────────────────────────────────────────────────── */

type Mode = "ingreso" | "egreso";
type CounterItem = {
  _id: string; name: string; unit: string; sku?: string; barcode?: string; category?: string;
  quantity?: number; avgCostCents?: number; lastPriceCents?: number; supplierId?: string;
} & Record<string, unknown>;
type Line = { item: CounterItem; quantity: string; unitCost: string };
type Ticket = TicketData & { _id: string; quoteNumber?: string };

const units = ["unidad", "kg", "litro", "metro", "m2", "m3", "bolsa", "balde", "rollo"];
const categories = ["materiales", "herramientas", "seguridad", "consumibles", "otros"];
const toNumber = (value: string) => Number(String(value).replace(",", ".")) || 0;
const round = (value: number) => Math.round(value * 1000) / 1000;

function codeOf(item: CounterItem) {
  return item.barcode || item.sku || "";
}

/** Los remitos de una salida: uno por depósito, con todos los materiales que salieron de ahí. */
function remitosOf(ticket: Ticket): RemitoData[] {
  return (ticket.remitos || []).map(remito => ({
    number: remito.number, date: ticket.date, kind: "egreso" as const,
    fromWarehouse: warehouseLabel(remito.warehouse), destination: ticket.destinationLabel || "Obra", quoteNumber: ticket.quoteNumber,
    items: ticket.lines.flatMap(line => (line.parts || []).filter(part => part.warehouse === remito.warehouse && part.quantity > 0)
      .map(part => ({ code: line.barcode || line.sku, name: line.name, unit: line.unit, quantity: part.quantity }))),
    note: ticket.note, userName: ticket.userName,
  }));
}

export function StockCounter({ canEdit }: { canEdit: boolean }) {
  const [mode, setMode] = useState<Mode>("egreso");
  const [lines, setLines] = useState<Line[]>([]);
  const [scanText, setScanText] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const [unknown, setUnknown] = useState<{ code: string } | null>(null);
  const [results, setResults] = useState<CounterItem[] | null>(null);
  const [camera, setCamera] = useState(false);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [works, setWorks] = useState<Option[]>([]);
  const [warehouse, setWarehouse] = useState<WarehouseKey>("central");
  // En la salida, vacío es "automático": primero del Central y lo que falte del Salón.
  const [outFrom, setOutFrom] = useState<"" | WarehouseKey>("");
  const [workId, setWorkId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Ticket | null>(null);
  const [recent, setRecent] = useState<Ticket[]>([]);
  const [printer, setPrinter] = useState<PrinterSettings>({ width: 80, autoPrint: false });
  // El formulario de datos se vuelve a montar limpio después de cada operación.
  const [formKey, setFormKey] = useState(0);
  const scanRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef(0);


  const loadRecent = useCallback(async () => {
    const response = await fetch("/api/stock/caja?limit=15").catch(() => null);
    if (response?.ok) setRecent(((await response.json()).items || []) as Ticket[]);
  }, []);

  useEffect(() => {
    // Lo guardado en este equipo (ancho del rollo) y los últimos comprobantes, recién montada la pantalla.
    const timer = window.setTimeout(() => { setPrinter(readPrinterSettings()); void loadRecent(); }, 0);
    const toOptions = (rows: Array<Record<string, unknown>>) => rows.map(row => ({ value: String(row._id), label: String(row.name || row.code || ""), hint: row.code ? String(row.code) : undefined }));
    void Promise.all([
      fetch("/api/records/suppliers?limit=100").then(response => response.ok ? response.json() : { items: [] }),
      fetch("/api/records/works?limit=100").then(response => response.ok ? response.json() : { items: [] }),
    ]).then(([supplierRows, workRows]) => {
      setSuppliers(toOptions(supplierRows.items || []));
      // Sólo las obras vivas: no se entrega material a una obra terminada.
      setWorks(toOptions((workRows.items || []).filter((row: Record<string, unknown>) => row.status !== "terminada" && row.status !== "cancelada")));
    }).catch(() => setError("No se pudieron cargar proveedores y obras"));
    // En la compu el cursor arranca en el cuadro de escaneo; en el celular no, para no abrir el teclado.
    if (window.matchMedia("(pointer: fine)").matches) scanRef.current?.focus();
    return () => window.clearTimeout(timer);
  }, [loadRecent]);

  function say(text: string, ok = true) {
    window.clearTimeout(flashTimer.current);
    setFlash({ text, ok });
    flashTimer.current = window.setTimeout(() => setFlash(null), 3500);
  }

  /** Suma el material a la lista (o una unidad más si ya estaba) y lo deja arriba de todo. */
  const addItem = useCallback((item: CounterItem, amount = 1) => {
    setDone(null);
    setConfirming(false);
    setLines(current => {
      const existing = current.find(line => line.item._id === item._id);
      if (existing) return [{ ...existing, item: { ...existing.item, ...item }, quantity: String(round(toNumber(existing.quantity) + amount)) }, ...current.filter(line => line !== existing)];
      const cents = Number(item.lastPriceCents || item.avgCostCents || 0);
      return [{ item, quantity: String(amount), unitCost: cents ? amountToInput(cents / 100) : "" }, ...current];
    });
    say(`${item.name}: +${qty(amount)} ${item.unit}`);
  }, []);

  const searchByName = useCallback(async (query: string) => {
    const response = await fetch(`/api/records/stock?limit=12&search=${encodeURIComponent(query)}`).catch(() => null);
    const rows = response?.ok ? ((await response.json()).items || []) as CounterItem[] : [];
    setResults(rows);
    return rows;
  }, []);

  /** Lo que leyó el lector, la cámara o lo que se escribió en el cuadro. */
  const handleCode = useCallback(async (raw: string) => {
    const text = cleanScannedCode(raw);
    if (!text) return;
    setError(""); setUnknown(null); setResults(null);
    // Si ya está en la lista, no hace falta preguntarle al servidor.
    const inList = lines.find(line => [line.item.barcode, line.item.sku].some(code => code && code.toLowerCase() === text.toLowerCase()));
    if (inList) { scanFeedback(true); addItem(inList.item); return; }
    setBusy(true);
    try {
      // Con espacios es un nombre, no un código: se busca directo.
      if (!/\s/.test(text)) {
        const response = await fetch(`/api/stock/scan?code=${encodeURIComponent(text)}`);
        if (response.ok) { scanFeedback(true); addItem((await response.json()).item as CounterItem); return; }
        if (response.status !== 404) { const result = await response.json().catch(() => ({})); throw new Error(result.error || "No se pudo buscar el código"); }
      }
      const found = await searchByName(text);
      scanFeedback(false);
      // Parece un código (sin espacios, con números) y no está: se ofrece asignarlo o crear el material.
      if (!/\s/.test(text) && /\d/.test(text)) setUnknown({ code: text });
      else if (!found.length) say(`No hay materiales que coincidan con "${text}"`, false);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se pudo buscar el código");
    } finally { setBusy(false); }
  }, [lines, addItem, searchByName]);

  useKeyboardScanner(code => { void handleCode(code); }, canEdit && !camera);

  const closeCamera = useCallback(() => setCamera(false), []);
  const onCameraCode = useCallback((code: string) => { void handleCode(code); }, [handleCode]);

  function submitScan(event: React.FormEvent) {
    event.preventDefault();
    const text = scanText;
    setScanText("");
    void handleCode(text).then(() => scanRef.current?.focus());
  }

  function updateLine(id: string, patch: Partial<Line>) {
    setConfirming(false);
    setLines(current => current.map(line => line.item._id === id ? { ...line, ...patch } : line));
  }

  function step(id: string, delta: number) {
    const line = lines.find(candidate => candidate.item._id === id);
    if (!line) return;
    updateLine(id, { quantity: String(Math.max(0, round(toNumber(line.quantity) + delta))) });
  }

  /** El código que se leyó y no estaba: se le asigna a un material que ya existe. */
  async function assignCode(item: CounterItem, code: string) {
    setBusy(true); setError("");
    const response = await fetch("/api/stock/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId: item._id, code }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setError(result.error || "No se pudo guardar el código");
    setUnknown(null); setResults(null);
    addItem({ ...item, barcode: code });
  }

  async function createItem(form: FormData, code: string) {
    setBusy(true); setError("");
    const body = { name: String(form.get("name") || ""), unit: String(form.get("unit") || "unidad"), category: String(form.get("category") || "materiales"), barcode: code, sku: "" };
    const response = await fetch("/api/records/stock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setError(result.error || "No se pudo crear el material");
    setUnknown(null); setResults(null);
    addItem(result as CounterItem);
  }

  /** Etiqueta con código de barras. Si el material no tiene código, se le genera uno propio. */
  async function printLabel(item: CounterItem) {
    let code = item.barcode || "";
    if (!code) {
      const response = await fetch("/api/stock/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId: item._id, generate: true }) });
      const result = await response.json();
      if (!response.ok) return setError(result.error || "No se pudo generar el código");
      code = String(result.barcode);
      setLines(current => current.map(line => line.item._id === item._id ? { ...line, item: { ...line.item, barcode: code } } : line));
    }
    await printLabels([{ name: item.name, code, unit: item.unit }], printer.width).catch(() => setError("No se pudo abrir la impresión"));
  }

  // Cómo queda cada renglón: en la salida, si alcanza y de qué depósito sale.
  const checked = useMemo(() => lines.map(line => {
    const amount = toNumber(line.quantity);
    const levels = levelsOf(line.item);
    const available = outFrom ? levels[outFrom] : totalOf(levels);
    const short = mode === "egreso" && amount > available + 1e-9;
    const parts = mode === "egreso" ? (outFrom ? [{ warehouse: outFrom, quantity: amount }] : splitDelivery(levels, amount).parts) : [];
    const unitCents = mode === "ingreso" ? Math.round(parseAmount(line.unitCost) * 100) : Number(line.item.avgCostCents || 0);
    return { line, amount, levels, available, short, parts, unitCents, totalCents: Math.round(amount * unitCents) };
  }), [lines, mode, outFrom]);

  const totalUnits = round(checked.reduce((total, row) => total + row.amount, 0));
  const totalCents = checked.reduce((total, row) => total + row.totalCents, 0);
  const shortRows = checked.filter(row => row.short);
  const emptyRows = checked.filter(row => row.amount <= 0);
  const ready = lines.length > 0 && !shortRows.length && !emptyRows.length && (mode === "ingreso" || !!workId);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    // Mueve el stock de varios materiales a la vez: se confirma dos veces, con el resumen a la vista.
    if (!confirming) return setConfirming(true);
    setConfirming(false); setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    const common = { note: String(form.get("note") || ""), date: String(form.get("date") || "") || undefined };
    const body = mode === "ingreso"
      ? { kind: mode, warehouse, supplierId, reference: String(form.get("reference") || ""), ...common, lines: checked.map(row => ({ itemId: row.line.item._id, quantity: row.amount, unitCostCents: row.unitCents })) }
      : { kind: mode, workId, warehouse: outFrom, ...common, lines: checked.map(row => ({ itemId: row.line.item._id, quantity: row.amount })) };
    const response = await fetch("/api/stock/caja", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setError(result.error || "No se pudo registrar la operación");
    const ticket = result as Ticket;
    setDone(ticket);
    setLines([]); setWorkId(""); setSupplierId(""); setFormKey(key => key + 1);
    void loadRecent();
    if (printer.autoPrint) void printTicket(ticket, printer.width).catch(() => setError("Se registró, pero no se pudo abrir la impresión del ticket"));
  }

  function changePrinter(patch: Partial<PrinterSettings>) {
    const next = { ...printer, ...patch };
    setPrinter(next);
    savePrinterSettings(next);
  }

  if (!canEdit) return <div className="notice error">No tenés permiso para mover stock. Pedíselo a gerencia en Usuarios y permisos.</div>;

  const entry = mode === "ingreso";
  return <>
    <div className="page-heading counter-heading">
      <div><p className="eyebrow">COMPRAS Y STOCK</p><h1>Caja</h1><p>Entradas y salidas de materiales con el lector de códigos de barras, la cámara del celular o buscando por nombre.</p></div>
      <div className="counter-printer" role="group" aria-label="Ticketera">
        <Printer size={16} />
        <span>Ticketera</span>
        {([58, 80] as const).map(width => <button key={width} type="button" className={printer.width === width ? "active" : ""} aria-pressed={printer.width === width} onClick={() => changePrinter({ width })}>{width} mm</button>)}
        <label className="counter-autoprint"><input type="checkbox" checked={printer.autoPrint} onChange={event => changePrinter({ autoPrint: event.target.checked })} /> Imprimir al confirmar</label>
      </div>
    </div>

    <div className="counter-modes" role="tablist" aria-label="Qué se registra">
      <button type="button" role="tab" aria-selected={!entry} className={!entry ? "active out" : ""} onClick={() => { setMode("egreso"); setConfirming(false); }}>
        <HardHat size={18} /><span><b>Salida a obra</b><small>Material que se entrega, con remito</small></span>
      </button>
      <button type="button" role="tab" aria-selected={entry} className={entry ? "active in" : ""} onClick={() => { setMode("ingreso"); setConfirming(false); }}>
        <ArrowDownToLine size={18} /><span><b>Entrada</b><small>Compra que llega al depósito</small></span>
      </button>
    </div>

    {done && <div className="notice success counter-done" role="status">
      <Check size={18} />
      <span>Listo: {done.kind === "ingreso" ? "entrada" : "salida"} registrada con el comprobante <b>{done.number}</b>{done.remitos?.length ? <> y {done.remitos.length === 1 ? "el remito" : "los remitos"} {done.remitos.map(remito => remito.number).join(" y ")}</> : null}.</span>
      <button type="button" className="secondary-btn" onClick={() => { void printTicket(done, printer.width).catch(() => setError("No se pudo abrir la impresión")); }}><Printer size={15} /> Imprimir ticket</button>
      {remitosOf(done).map(remito => <button key={remito.number} type="button" className="secondary-btn" onClick={() => { void downloadRemitoPdf(remito); }}><FileText size={15} /> {remito.number}</button>)}
      <button type="button" className="icon-btn" onClick={() => setDone(null)} aria-label="Cerrar aviso"><X size={16} /></button>
    </div>}
    {error && <div className="notice error">{error}</div>}

    <div className="counter-layout">
      <section className="panel counter-main">
        <form className="counter-scan" onSubmit={submitScan}>
          <div className={busy ? "counter-scan-input busy" : "counter-scan-input"}>
            <ScanBarcode size={22} />
            <input ref={scanRef} value={scanText} onChange={event => setScanText(event.target.value)} placeholder="Escaneá el código o escribí el nombre…" autoComplete="off" enterKeyHint="search" aria-label="Código de barras o nombre del material" />
            <button type="submit" className="icon-btn" disabled={!scanText.trim() || busy} aria-label="Buscar"><Search size={18} /></button>
          </div>
          <button type="button" className="primary-btn counter-camera-btn" onClick={() => setCamera(true)}><Camera size={18} /> Cámara</button>
        </form>
        <p className="counter-hint">Con el lector de mano no hace falta hacer clic en ningún lado: escaneá y se suma. Cada lectura es una unidad más.</p>
        {flash && <p className={flash.ok ? "counter-flash ok" : "counter-flash"} role="status">{flash.ok ? <Check size={15} /> : <TriangleAlert size={15} />} {flash.text}</p>}

        {unknown && <UnknownCode code={unknown.code} busy={busy} onAssign={item => { void assignCode(item, unknown.code); }} onCreate={form => { void createItem(form, unknown.code); }} onClose={() => { setUnknown(null); setResults(null); }} />}

        {!unknown && results && <div className="counter-results">
          <div className="counter-results-head"><b>{results.length ? "¿Cuál de estos?" : "No se encontró ningún material"}</b><button type="button" className="icon-btn" onClick={() => setResults(null)} aria-label="Cerrar resultados"><X size={16} /></button></div>
          {results.map(item => <button type="button" key={item._id} onClick={() => { setResults(null); addItem(item); }}>
            <span><b>{item.name}</b><small>{[codeOf(item) && `Cód. ${codeOf(item)}`, `${qty(Number(item.quantity || 0))} ${item.unit} en stock`].filter(Boolean).join(" · ")}</small></span><Plus size={16} />
          </button>)}
        </div>}

        {!lines.length ? <div className="counter-empty">
          <ScanBarcode size={38} />
          <b>Todavía no hay materiales</b>
          <span>Escaneá el primero con el lector o la cámara, o buscalo por nombre.</span>
        </div> : <ul className="counter-lines">
          {checked.map(({ line, amount, levels, short, parts, unitCents, totalCents: lineCents }) => <li key={line.item._id} className={short || amount <= 0 ? "counter-line problem" : "counter-line"}>
            <div className="counter-line-info">
              <b>{line.item.name}</b>
              <small>{[codeOf(line.item) && `Cód. ${codeOf(line.item)}`, WAREHOUSES.map(entry => `${entry.short} ${qty(levels[entry.key])}`).join(" · ")].filter(Boolean).join(" · ")} {line.item.unit}</small>
              {mode === "egreso" && amount > 0 && (short
                ? <small className="below">No alcanza: {outFrom ? `en ${warehouseLabel(outFrom)} hay ${qty(levels[outFrom])}` : `entre los depósitos hay ${qty(totalOf(levels))}`} {line.item.unit}</small>
                : parts.length > 1 && <small>Sale {parts.map(part => `${qty(part.quantity)} del ${WAREHOUSES.find(entry => entry.key === part.warehouse)?.short}`).join(" y ")}</small>)}
            </div>
            <div className="counter-qty">
              <button type="button" onClick={() => step(line.item._id, -1)} aria-label="Uno menos"><Minus size={15} /></button>
              <input inputMode="decimal" value={line.quantity} onChange={event => updateLine(line.item._id, { quantity: event.target.value.replace(/[^\d,.]/g, "") })} aria-label={`Cantidad de ${line.item.name}`} />
              <button type="button" onClick={() => step(line.item._id, 1)} aria-label="Uno más"><Plus size={15} /></button>
              <span>{line.item.unit}</span>
            </div>
            {entry ? <label className="counter-cost"><span>Costo unit.</span><div className="money-input"><span className="money-prefix">$</span>
              <input inputMode="decimal" value={line.unitCost} placeholder="0,00" onChange={event => updateLine(line.item._id, { unitCost: event.target.value.replace(/[^\d,.]/g, "") })} aria-label={`Costo unitario de ${line.item.name}`} /></div></label>
              : <span className="counter-cost readonly"><span>Costo a obra</span><b>{money(lineCents)}</b></span>}
            {entry && <strong className="counter-line-total">{money(Math.round(amount * unitCents))}</strong>}
            <div className="counter-line-actions">
              <button type="button" title="Imprimir la etiqueta con el código de barras" onClick={() => { void printLabel(line.item); }}><Tag size={16} /></button>
              <button type="button" title="Sacar de la lista" onClick={() => { setConfirming(false); setLines(current => current.filter(candidate => candidate !== line)); }}><Trash2 size={16} /></button>
            </div>
          </li>)}
        </ul>}
      </section>

      <form className="panel counter-side" onSubmit={submit} key={`${mode}-${formKey}`}>
        <div className="counter-side-body">
          <p className="eyebrow">{entry ? "ENTRADA" : "SALIDA A OBRA"}</p>
          {entry ? <>
            <div className="counter-field"><span>Entra al depósito *</span><div className="counter-segment">{WAREHOUSES.map(entry => <button key={entry.key} type="button" className={warehouse === entry.key ? "active" : ""} aria-pressed={warehouse === entry.key} onClick={() => { setWarehouse(entry.key); setConfirming(false); }}>{entry.label}</button>)}</div></div>
            <label className="counter-field"><span>Proveedor</span><SearchSelect name="supplierId" options={suppliers} value={supplierId} onChange={setSupplierId} placeholder="Elegí el proveedor…" /></label>
            <label className="counter-field"><span>Factura o remito del proveedor</span><input name="reference" placeholder="Número del comprobante" /></label>
          </> : <>
            <label className="counter-field"><span>Obra *</span><SearchSelect name="workId" options={works} value={workId} onChange={value => { setWorkId(value); setConfirming(false); }} placeholder="¿A qué obra se entrega?" /></label>
            <div className="counter-field"><span>Sale de</span><div className="counter-segment">
              <button type="button" className={!outFrom ? "active" : ""} aria-pressed={!outFrom} onClick={() => { setOutFrom(""); setConfirming(false); }}>Automático</button>
              {WAREHOUSES.map(entry => <button key={entry.key} type="button" className={outFrom === entry.key ? "active" : ""} aria-pressed={outFrom === entry.key} onClick={() => { setOutFrom(entry.key); setConfirming(false); }}>{entry.short}</button>)}
            </div><small className="field-hint">{outFrom ? `Todo sale del ${warehouseLabel(outFrom)}` : "Primero del Central y lo que falte del Salón. Un remito por depósito."}</small></div>
          </>}
          <label className="counter-field"><span>Fecha</span><DateInput name="date" defaultValue={todayIso()} recent /></label>
          <label className="counter-field"><span>Observaciones</span><textarea name="note" rows={2} placeholder={entry ? "Detalle de la entrada" : "Quién retiró, en qué vehículo…"} /></label>

          <div className="counter-totals">
            <div><span>Materiales</span><b>{lines.length}</b></div>
            <div><span>Unidades</span><b>{qty(totalUnits)}</b></div>
            <div className="wide"><span>{entry ? "Total de la compra (sin IVA)" : "Costo que va a la obra"}</span><strong>{money(totalCents)}</strong></div>
          </div>
          {shortRows.length > 0 && <p className="form-error">No alcanza el stock de {shortRows.length === 1 ? shortRows[0].line.item.name : `${shortRows.length} materiales`}: bajá la cantidad o elegí otro depósito.</p>}
          {emptyRows.length > 0 && <p className="form-error">Hay materiales con cantidad cero: corregila o sacalos de la lista.</p>}
          {!entry && lines.length > 0 && !workId && <p className="counter-note">Elegí la obra para poder confirmar.</p>}
        </div>
        <footer>
          {confirming && <span className="counter-confirm-text">{entry ? "Entran" : "Salen"} {qty(totalUnits)} unidades de {lines.length} {lines.length === 1 ? "material" : "materiales"}. Queda a tu nombre.</span>}
          {confirming && <button type="button" className="secondary-btn" onClick={() => setConfirming(false)}>Volver</button>}
          <button className={confirming ? "primary-btn confirming" : "primary-btn"} disabled={saving || !ready}>
            {saving ? "Registrando…" : confirming ? <><Check size={16} /> Sí, confirmar</> : entry ? <><PackagePlus size={16} /> Confirmar entrada</> : <><HardHat size={16} /> Confirmar salida</>}
          </button>
        </footer>
      </form>
    </div>

    <section className="panel counter-recent">
      <div className="panel-head"><div><p className="eyebrow">ÚLTIMOS COMPROBANTES</p><h2>Lo que pasó por la caja</h2><p>Para volver a imprimir un ticket o un remito</p></div></div>
      {!recent.length ? <p className="task-history-state">Todavía no hay operaciones.</p>
        : <div className="table-scroll"><table><thead><tr><th>Comprobante</th><th>Fecha</th><th>Tipo</th><th>Destino / proveedor</th><th>Materiales</th><th>Importe</th><th>Hizo</th><th /></tr></thead><tbody>
          {recent.map(ticket => <tr key={ticket._id}>
            <td data-label="Comprobante"><b>{ticket.number}</b></td>
            <td data-label="Fecha">{dateTime(ticket.createdAt || ticket.date)}</td>
            <td data-label="Tipo"><span className={`badge ${ticket.kind}`}>{ticket.kind === "ingreso" ? "Entrada" : "Salida a obra"}</span></td>
            <td data-label="Destino / proveedor">{ticket.kind === "ingreso" ? `${warehouseLabel(ticket.warehouse)}${ticket.supplierName ? ` · ${ticket.supplierName}` : ""}` : ticket.destinationLabel || "—"}</td>
            <td data-label="Materiales">{ticket.lines.length}</td>
            <td data-label="Importe">{money(ticket.totalCents || 0)}</td>
            <td data-label="Hizo">{ticket.userName || "—"}</td>
            <td className="row-actions">
              <button title="Imprimir el ticket" onClick={() => { void printTicket(ticket, printer.width).catch(() => setError("No se pudo abrir la impresión")); }}><Printer size={16} /></button>
              {remitosOf(ticket).map(remito => <button key={remito.number} className="row-action-wide" title={`Descargar el remito ${remito.number} en PDF`} onClick={() => { void downloadRemitoPdf(remito); }}><FileText size={15} /> {remito.number}</button>)}
            </td>
          </tr>)}
        </tbody></table></div>}
    </section>

    {camera && <CameraScanner continuous onDetected={onCameraCode} onClose={closeCamera} title={entry ? "Escanear lo que entra" : "Escanear lo que sale"} />}
  </>;
}

/** Un código que no es de ningún material: se le asigna a uno que ya existe o se da de alta el material. */
function UnknownCode({ code, busy, onAssign, onCreate, onClose }: { code: string; busy: boolean; onAssign: (item: CounterItem) => void; onCreate: (form: FormData) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"assign" | "create">("assign");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CounterItem[]>([]);

  useEffect(() => {
    if (tab !== "assign") return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/records/stock?limit=10&search=${encodeURIComponent(query)}`)
        .then(response => response.ok ? response.json() : { items: [] })
        .then(result => setRows((result.items || []) as CounterItem[]))
        .catch(() => setRows([]));
    }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [query, tab]);

  return <div className="counter-unknown">
    <div className="counter-results-head">
      <span><TriangleAlert size={16} /> <b>El código {code} no es de ningún material</b></span>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar"><X size={16} /></button>
    </div>
    <div className="stock-tabs counter-unknown-tabs">
      <button type="button" className={tab === "assign" ? "active" : ""} onClick={() => setTab("assign")}>Es de un material que ya está</button>
      <button type="button" className={tab === "create" ? "active" : ""} onClick={() => setTab("create")}>Es un material nuevo</button>
    </div>
    {tab === "assign" ? <>
      <div className="search counter-unknown-search"><Search size={16} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscá el material por nombre…" /></div>
      <div className="counter-results flat">{rows.map(item => <button type="button" key={item._id} disabled={busy} onClick={() => onAssign(item)}>
        <span><b>{item.name}</b><small>{item.barcode ? `Ya tiene el código ${item.barcode}: se reemplaza` : item.sku ? `Cód. interno ${item.sku}` : "Sin código"}</small></span><Plus size={16} />
      </button>)}{!rows.length && <p className="select-empty">Sin resultados.</p>}</div>
    </> : <form className="form-grid counter-unknown-form" onSubmit={event => { event.preventDefault(); onCreate(new FormData(event.currentTarget)); }}>
      <label className="wide"><span>Nombre del material *</span><input name="name" required autoFocus placeholder="Cemento Loma Negra 50 kg" /></label>
      <label><span>Unidad *</span><select name="unit" defaultValue="unidad">{units.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label>
      <label><span>Rubro *</span><select name="category" defaultValue="materiales">{categories.map(category => <option key={category} value={category}>{category[0].toUpperCase() + category.slice(1)}</option>)}</select></label>
      <div className="wide counter-unknown-actions"><small>Queda cargado con el código {code} y sin stock; la cantidad la suma esta operación.</small><button className="primary-btn" disabled={busy}><PackagePlus size={16} /> Crear y sumar</button></div>
    </form>}
  </div>;
}
