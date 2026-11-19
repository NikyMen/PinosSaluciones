"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banknote, Camera, Check, CreditCard, FileDown, Landmark, Minus, Plus, Printer, ReceiptText, ScanBarcode, Store, Trash2, TriangleAlert, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { DateInput, SearchSelect, type Option } from "@/components/fields";
import { CameraScanner, scanFeedback, useKeyboardScanner } from "@/components/barcode-scanner";
import { amountToInput, dateTime, money, parseAmount, qty, todayIso } from "@/lib/format";
import { levelsOf } from "@/lib/stock-levels";
import { COMPANIES, COMPANY_KEYS, type CompanyKey } from "@/lib/companies";
import { cleanScannedCode } from "@/lib/barcode";
import { fetchAllRecords } from "@/lib/fetch-all-records";
import { cashMethodLabels } from "@/lib/cash-methods";
import { VAT_CONDITION_KEYS, VAT_CONDITIONS, type VatCondition } from "@/lib/fiscal";
import { counterTotals, finalUnitCents } from "@/lib/counter-totals";
import { printSaleTicket, readPrinterSettings, savePrinterSettings, type PrinterSettings, type SaleTicketData } from "@/lib/ticket-print";
import { downloadSaleInvoicePdf } from "@/lib/invoice-pdf";
import { downloadFiscalInvoicePdf, fiscalInvoicePdfData } from "@/lib/fiscal-invoice-pdf";

/* ─────────────────────────────────────────────────────────────────────────────
   Mostrador: la venta al público, en un solo paso.

   Los productos con stock se ven en una lista que se filtra con cada letra
   (o se escanean con el lector o la cámara). Se elige el comprobante y con qué
   paga, y al cobrar el servidor hace el remito (baja el stock: primero el Salón
   y lo que falte del Galpón), la factura (B o A en ARCA, o X) y el recibo, en la
   caja o cuenta que corresponde al medio. Sin cliente elegido, consumidor final.
   Ver src/lib/counter-sales.ts.
   ───────────────────────────────────────────────────────────────────────────── */

type Product = { _id: string; name: string; unit: string; sku?: string; barcode?: string; salePriceCents?: number } & Record<string, unknown>;
type Line = { item: Product; quantity: string; price: string; discount: string };
type ClientRow = { _id: string; name: string; cuit?: string; vatCondition?: string; code?: number };
type Sale = SaleTicketData & { _id: string; voucherType: string; status: string; warning?: string; invoiceId?: string; clientId?: string };
type Day = { day: string; items: Sale[]; summary: { count: number; totalCents: number; pendingCents: number; byMethod: Array<{ method: string; label: string; amountCents: number }>; byVoucher: Array<{ voucherType: string; amountCents: number }> } };

const VOUCHERS = [
  { key: "factura_b", label: "Factura B" },
  { key: "factura_a", label: "Factura A" },
  { key: "factura_x", label: "Factura X" },
] as const;
type Voucher = (typeof VOUCHERS)[number]["key"];
const voucherName = (key: string) => VOUCHERS.find(voucher => voucher.key === key)?.label || key;
/** La letra que le toca al cliente: A al inscripto y al monotributista, B al resto. */
const letterFor = (condition?: string): Voucher => condition === "responsable_inscripto" || condition === "monotributo" ? "factura_a" : "factura_b";

const METHODS = [
  { key: "efectivo", label: "Efectivo", icon: Banknote },
  { key: "transferencia", label: "Transferencia", icon: Landmark },
  { key: "tarjeta", label: "Tarjeta", icon: CreditCard },
] as const;
type Method = (typeof METHODS)[number]["key"];

const SOURCES = [
  { key: "auto", label: "Salón y Galpón", hint: "Primero del Salón y lo que falte del Galpón." },
  { key: "salon", label: "Salón", hint: "Todo sale del Salón de Ventas." },
  { key: "central", label: "Galpón", hint: "Todo sale del Galpón." },
] as const;
type Source = (typeof SOURCES)[number]["key"];

const round = (value: number) => Math.round(value * 1000) / 1000;
const toNumber = (value: string) => Number(value.replace(",", ".")) || 0;
const onlyAmount = (value: string) => value.replace(/[^\d,.]/g, "");
const codeOf = (item: Product) => item.barcode || item.sku || "";
const methodLabel = (method: string) => cashMethodLabels[method] || method;
/** Lo que se puede vender de un producto según de dónde sale. */
function availableOf(item: Product, from: Source) {
  const levels = levelsOf(item as Record<string, unknown>);
  return { ...levels, available: from === "auto" ? round(levels.salon + levels.central) : levels[from] };
}

export function CounterSale({ canSell }: { canSell: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<{ items: Product[]; total: number } | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const [camera, setCamera] = useState(false);
  const [company, setCompany] = useState<CompanyKey>("tvp");
  const [voucher, setVoucher] = useState<Voucher>("factura_b");
  const [from, setFrom] = useState<Source>("auto");
  const [method, setMethod] = useState<Method>("efectivo");
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState("");
  const [creatingClient, setCreatingClient] = useState(false);
  const [cashGiven, setCashGiven] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Sale | null>(null);
  const [day, setDay] = useState(todayIso());
  const [dayData, setDayData] = useState<Day | null>(null);
  const [printer, setPrinter] = useState<PrinterSettings>({ width: 80, autoPrint: false });
  const searchRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef(0);
  const catalogRequest = useRef(0);

  const loadDay = useCallback(async (value: string) => {
    const response = await fetch(`/api/mostrador?day=${value}`).catch(() => null);
    if (response?.ok) setDayData(await response.json() as Day);
  }, []);

  useEffect(() => {
    // Lo guardado en este equipo (ancho del rollo) y las ventas de hoy, recién montada la pantalla.
    const timer = window.setTimeout(() => { setPrinter(readPrinterSettings()); void loadDay(todayIso()); }, 0);
    // Sin permiso para ver clientes, se vende igual a consumidor final.
    void fetchAllRecords("clients").then(rows => setClients((rows as ClientRow[]).filter(row => (row as Record<string, unknown>).active !== false))).catch(() => setClients([]));
    if (window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus();
    return () => window.clearTimeout(timer);
  }, [loadDay]);

  // La lista de productos se filtra mientras se escribe: sin Enter, con cada letra.
  useEffect(() => {
    const request = ++catalogRequest.current;
    const timer = window.setTimeout(() => {
      setLoadingCatalog(true);
      void fetch(`/api/mostrador/productos?from=${from}&search=${encodeURIComponent(query.trim())}`)
        .then(response => response.ok ? response.json() : { items: [], total: 0 })
        .then(result => { if (request === catalogRequest.current) setCatalog(result as { items: Product[]; total: number }); })
        .catch(() => { if (request === catalogRequest.current) setCatalog({ items: [], total: 0 }); })
        .finally(() => { if (request === catalogRequest.current) setLoadingCatalog(false); });
    }, query ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [query, from, catalogVersion]);

  const client = clients.find(row => row._id === clientId) || null;
  const clientOptions: Option[] = useMemo(() => clients.map(row => ({ value: row._id, label: row.name, hint: [row.code && `N° ${row.code}`, row.cuit].filter(Boolean).join(" · ") || undefined })), [clients]);

  function say(text: string, ok = true) {
    window.clearTimeout(flashTimer.current);
    setFlash({ text, ok });
    flashTimer.current = window.setTimeout(() => setFlash(null), 3500);
  }

  /** Suma el producto (o una unidad más) y lo deja arriba. El precio sale del precio de venta de Stock. */
  const addItem = useCallback((item: Product, amount = 1) => {
    setDone(null); setConfirming(false);
    setLines(current => {
      const existing = current.find(line => line.item._id === item._id);
      if (existing) return [{ ...existing, item: { ...existing.item, ...item }, quantity: String(round(toNumber(existing.quantity) + amount)) }, ...current.filter(line => line !== existing)];
      const cents = Number(item.salePriceCents || 0);
      return [{ item, quantity: String(amount), price: cents ? amountToInput(cents / 100) : "", discount: "" }, ...current];
    });
    say(`${item.name}: +${qty(amount)} ${item.unit}${item.salePriceCents ? "" : " · no tiene precio de venta: cargalo"}`, Boolean(item.salePriceCents));
  }, []);

  /** Lo que leyó el lector o la cámara: se busca el código y se suma. */
  const handleCode = useCallback(async (raw: string) => {
    const text = cleanScannedCode(raw);
    if (!text) return false;
    setError("");
    const inList = lines.find(line => [line.item.barcode, line.item.sku].some(code => code && code.toLowerCase() === text.toLowerCase()));
    if (inList) { scanFeedback(true); addItem(inList.item); return true; }
    if (/\s/.test(text)) return false;
    const response = await fetch(`/api/stock/scan?code=${encodeURIComponent(text)}`).catch(() => null);
    if (response?.ok) { scanFeedback(true); addItem((await response.json()).item as Product); return true; }
    return false;
  }, [lines, addItem]);

  useKeyboardScanner(code => { void handleCode(code).then(found => { if (!found) { scanFeedback(false); say(`El código ${code} no es de ningún producto`, false); } }); }, canSell && !camera && !creatingClient);
  const closeCamera = useCallback(() => setCamera(false), []);
  const onCameraCode = useCallback((code: string) => { void handleCode(code); }, [handleCode]);

  /** Enter en el buscador: un código leído se suma; si la lista quedó con un solo producto, también. */
  async function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    if (await handleCode(text)) { setQuery(""); return; }
    if (catalog?.items.length === 1) { addItem(catalog.items[0]); setQuery(""); }
  }

  function pick(item: Product) {
    addItem(item);
    setQuery("");
    searchRef.current?.focus();
  }

  function updateLine(id: string, patch: Partial<Line>) {
    setConfirming(false);
    setLines(current => current.map(line => line.item._id === id ? { ...line, ...patch } : line));
  }

  function step(id: string, delta: number) {
    const line = lines.find(candidate => candidate.item._id === id);
    if (line) updateLine(id, { quantity: String(Math.max(0, round(toNumber(line.quantity) + delta))) });
  }

  function pickClient(value: string) {
    setClientId(value); setConfirming(false);
    const row = clients.find(candidate => candidate._id === value);
    // La letra sigue al cliente; la X se mantiene si se la eligió a mano.
    if (voucher !== "factura_x") setVoucher(row ? letterFor(row.vatCondition) : "factura_b");
  }

  const checked = useMemo(() => {
    const rows = lines.map(line => ({ line, amount: toNumber(line.quantity), priceCents: Math.round(parseAmount(line.price) * 100), discountCents: Math.round(parseAmount(line.discount) * 100), stock: availableOf(line.item, from) }));
    const { rows: amounts, ...totals } = counterTotals(voucher, rows.map(row => ({ quantity: row.amount, unitPriceCents: row.priceCents, discountCents: row.discountCents })));
    return { ...totals, rows: rows.map((row, index) => ({ ...row, totalCents: amounts[index].totalCents, gross: amounts[index].gross, short: row.amount > row.stock.available + 1e-9 })) };
  }, [lines, voucher, from]);

  const totalCents = checked.amountCents;
  const cashGivenCents = Math.round(parseAmount(cashGiven) * 100);
  const changeCents = method === "efectivo" && cashGivenCents > totalCents ? cashGivenCents - totalCents : 0;
  const sourceLabel = SOURCES.find(source => source.key === from)!;
  const problems = [
    !lines.length ? "" : checked.rows.some(row => row.amount <= 0) ? "Hay productos con cantidad cero: corregila o sacalos" : "",
    checked.rows.some(row => row.short) ? `No alcanza el stock de algún producto (${sourceLabel.label})` : "",
    checked.rows.some(row => row.priceCents <= 0) ? "Hay productos sin precio" : "",
    checked.rows.some(row => row.discountCents > row.gross) ? "Un descuento pasa el importe de su renglón" : "",
    voucher === "factura_a" && !client?.cuit ? "La Factura A va a un cliente con CUIT: elegilo o dalo de alta" : "",
  ].filter(Boolean);
  const ready = lines.length > 0 && totalCents > 0 && !problems.length;

  async function submit() {
    if (!ready) return;
    if (!confirming) return setConfirming(true);
    setConfirming(false); setSaving(true); setError("");
    try {
      const body = {
        company, voucherType: voucher, clientId: clientId || undefined, note, from, method,
        lines: checked.rows.map(row => ({ itemId: row.line.item._id, quantity: row.amount, unitPriceCents: row.priceCents, discountCents: row.discountCents })),
      };
      const response = await fetch("/api/mostrador", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo registrar la venta");
      const sale = { ...(result.sale as Sale), changeCents, warning: result.warning || undefined };
      setDone(sale);
      setLines([]); setClientId(""); setNote(""); setCashGiven(""); setVoucher("factura_b"); setMethod("efectivo");
      // El stock cambió: la lista se vuelve a pedir.
      setCatalogVersion(version => version + 1);
      void loadDay(day);
      if (printer.autoPrint) void printTicket(sale);
      searchRef.current?.focus();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se pudo registrar la venta");
    } finally { setSaving(false); }
  }

  function printTicket(sale: Sale) {
    return printSaleTicket(sale, printer.width, { companyName: COMPANIES[(sale.company as CompanyKey) || "tvp"]?.legalName, methodLabel })
      .catch(() => setError("No se pudo abrir la impresión del ticket"));
  }

  /** La factura en PDF: la fiscal con CAE y QR, o la copia de gestión de la X, con los productos de la venta. */
  async function downloadInvoice(sale: Sale) {
    const read = (path: string) => fetch(path).then(response => response.ok ? response.json() : null).catch(() => null);
    const [invoice, customer] = await Promise.all([sale.invoiceId ? read(`/api/records/invoices/${sale.invoiceId}`) : null, sale.clientId ? read(`/api/records/clients/${sale.clientId}`) : null]);
    if (!invoice) return setError("No se encontró la factura de la venta");
    const printLines = sale.lines.map(line => ({ description: line.name, quantity: line.quantity, unit: line.unit, unitCents: Number(line.unitPriceCents || 0) }));
    const discountCents = sale.lines.reduce((total, line) => total + Number(line.discountCents || 0), 0) || undefined;
    const download = invoice.cae
      ? downloadFiscalInvoicePdf({ ...fiscalInvoicePdfData(invoice, customer), lines: printLines, discountCents, products: true })
      : downloadSaleInvoicePdf({ ...invoice, lines: printLines, discountCents }, customer || undefined);
    await download.catch(() => setError("No se pudo generar el PDF de la factura"));
  }

  function changePrinter(patch: Partial<PrinterSettings>) {
    const next = { ...printer, ...patch };
    setPrinter(next);
    savePrinterSettings(next);
  }

  async function createClient(form: FormData) {
    setError("");
    const body = { name: String(form.get("name") || ""), cuit: String(form.get("cuit") || ""), vatCondition: String(form.get("vatCondition") || ""), address: String(form.get("address") || ""), phones: [], active: true };
    const response = await fetch("/api/records/clients", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) {
      const details = result.details?.fieldErrors as Record<string, string[]> | undefined;
      return setError(details ? Object.values(details).flat()[0] || result.error : result.error || "No se pudo crear el cliente");
    }
    const row = result as ClientRow;
    setClients(current => [...current, row]);
    setCreatingClient(false);
    pickClient(row._id);
    setVoucher(letterFor(row.vatCondition));
  }

  if (!canSell) return <div className="notice error">Para vender en el mostrador hace falta poder mover stock, cargar facturas de venta y cobrar. Pedíselo a Gerencia en Perfil › Seguridad › Usuarios y permisos.</div>;

  const fiscal = voucher !== "factura_x";
  const inSale = new Map(lines.map(line => [line.item._id, toNumber(line.quantity)]));
  return <>
    <div className="page-heading counter-heading">
      <div><p className="eyebrow">VENTAS</p><h1>Mostrador</h1><p>Venta al público: elegí los productos de la lista (o escanealos), cobrá y sale la factura con su ticket. El stock se descuenta del Salón y, si no alcanza, del Galpón.</p></div>
      <div className="counter-printer" role="group" aria-label="Ticketera">
        <Printer size={16} />
        <span>Ticketera</span>
        {([58, 80] as const).map(width => <button key={width} type="button" className={printer.width === width ? "active" : ""} aria-pressed={printer.width === width} onClick={() => changePrinter({ width })}>{width} mm</button>)}
        <label className="counter-autoprint"><input type="checkbox" checked={printer.autoPrint} onChange={event => changePrinter({ autoPrint: event.target.checked })} /> Imprimir al cobrar</label>
      </div>
    </div>

    {done && <div className={done.warning ? "notice warning counter-done" : "notice success counter-done"} role="status">
      {done.warning ? <TriangleAlert size={18} /> : <Check size={18} />}
      <span>Venta <b>{done.number}</b> por <b>{money(done.amountCents)}</b>: {done.invoiceLabel}{done.receiptNumber ? <>, recibo {done.receiptNumber}</> : null}.{done.changeCents ? <> Vuelto: <b>{money(done.changeCents)}</b>.</> : null}{done.warning ? <> {done.warning}</> : null}</span>
      <button type="button" className="secondary-btn" onClick={() => { void printTicket(done); }}><Printer size={15} /> Ticket</button>
      <button type="button" className="secondary-btn" onClick={() => { void downloadInvoice(done); }}><FileDown size={15} /> Factura PDF</button>
      <button type="button" className="icon-btn" onClick={() => setDone(null)} aria-label="Cerrar aviso"><X size={16} /></button>
    </div>}
    {error && <div className="notice error">{error}</div>}

    <div className="counter-layout">
      <section className="panel counter-main">
        <form className="counter-scan" onSubmit={event => { void submitSearch(event); }}>
          <div className={loadingCatalog ? "counter-scan-input busy" : "counter-scan-input"}>
            <ScanBarcode size={22} />
            <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Escribí para filtrar o escaneá el código…" autoComplete="off" enterKeyHint="search" aria-label="Buscar producto por nombre o código" />
            {query && <button type="button" className="icon-btn" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label="Borrar la búsqueda"><X size={18} /></button>}
          </div>
          <button type="button" className="primary-btn counter-camera-btn" onClick={() => setCamera(true)}><Camera size={18} /> Cámara</button>
        </form>
        {flash && <p className={flash.ok ? "counter-flash ok" : "counter-flash"} role="status">{flash.ok ? <Check size={15} /> : <TriangleAlert size={15} />} {flash.text}</p>}

        <div className="mostrador-catalog" aria-label="Productos con stock">
          <div className="mostrador-catalog-head">
            <span>Producto</span><span>Salón</span><span>Galpón</span><span>Precio s/IVA</span><span />
          </div>
          <div className="mostrador-catalog-body">
            {catalog?.items.map(item => {
              const levels = levelsOf(item as Record<string, unknown>);
              const taken = inSale.get(item._id);
              return <button type="button" key={item._id} className={taken ? "mostrador-catalog-row taken" : "mostrador-catalog-row"} onClick={() => pick(item)}>
                <span className="mostrador-catalog-name"><b>{item.name}</b>{codeOf(item) && <small>Cód. {codeOf(item)}</small>}</span>
                <span data-label="Salón">{qty(levels.salon)}</span>
                <span data-label="Galpón">{qty(levels.central)}</span>
                <span data-label="Precio">{item.salePriceCents ? money(Number(item.salePriceCents)) : <em>sin precio</em>}</span>
                <span className="mostrador-catalog-add">{taken ? <>{qty(taken)} <Check size={14} /></> : <Plus size={16} />}</span>
              </button>;
            })}
            {catalog && !catalog.items.length && <p className="mostrador-catalog-empty">{query ? `No hay productos con stock que coincidan con "${query}".` : "No hay productos con stock."}</p>}
            {!catalog && <p className="mostrador-catalog-empty">Cargando productos…</p>}
          </div>
          {catalog && catalog.total > catalog.items.length && <p className="mostrador-catalog-more">Se ven {catalog.items.length} de {catalog.total} productos: seguí escribiendo para filtrar.</p>}
        </div>

        {!lines.length ? <div className="counter-empty mostrador-empty">
          <Store size={30} />
          <b>Nueva venta</b>
          <span>Tocá un producto de la lista para sumarlo, o escanealo.</span>
        </div> : <ul className="counter-lines">
          {checked.rows.map(({ line, amount, stock, short, priceCents, totalCents: lineCents }) => <li key={line.item._id} className={short || amount <= 0 || priceCents <= 0 ? "counter-line mostrador-line problem" : "counter-line mostrador-line"}>
            <div className="counter-line-info">
              <b>{line.item.name}</b>
              <small>{[codeOf(line.item) && `Cód. ${codeOf(line.item)}`, `Salón ${qty(stock.salon)} · Galpón ${qty(stock.central)} ${line.item.unit}`].filter(Boolean).join(" · ")}</small>
              {short && <small className="below">No alcanza: {from === "auto" ? "entre el Salón y el Galpón" : `en el ${sourceLabel.label}`} hay {qty(stock.available)} {line.item.unit}</small>}
            </div>
            <div className="counter-qty">
              <button type="button" onClick={() => step(line.item._id, -1)} aria-label="Uno menos"><Minus size={15} /></button>
              <input inputMode="decimal" value={line.quantity} onChange={event => updateLine(line.item._id, { quantity: onlyAmount(event.target.value) })} aria-label={`Cantidad de ${line.item.name}`} />
              <button type="button" onClick={() => step(line.item._id, 1)} aria-label="Uno más"><Plus size={15} /></button>
              <span>{line.item.unit}</span>
            </div>
            <div className="counter-cost mostrador-price">
              <label><span>Precio s/IVA</span><div className="money-input"><span className="money-prefix">$</span><input inputMode="decimal" value={line.price} placeholder="0,00" onChange={event => updateLine(line.item._id, { price: onlyAmount(event.target.value) })} aria-label={`Precio de ${line.item.name}`} /></div></label>
              <label><span>Desc. $</span><div className="money-input"><span className="money-prefix">$</span><input inputMode="decimal" value={line.discount} placeholder="0,00" onChange={event => updateLine(line.item._id, { discount: onlyAmount(event.target.value) })} aria-label={`Descuento de ${line.item.name}`} /></div></label>
              {fiscal && priceCents > 0 && <small>Final c/IVA {money(finalUnitCents(voucher, priceCents))}</small>}
            </div>
            <strong className="counter-line-total">{money(lineCents)}</strong>
            <div className="counter-line-actions">
              <button type="button" title="Sacar de la venta" onClick={() => { setConfirming(false); setLines(current => current.filter(candidate => candidate !== line)); }}><Trash2 size={16} /></button>
            </div>
          </li>)}
        </ul>}
      </section>

      <div className="panel counter-side">
        <div className="counter-side-body">
          <p className="eyebrow">COBRO</p>
          <div className="counter-field"><span>Vende</span><div className="counter-segment">{COMPANY_KEYS.map(key => <button key={key} type="button" className={company === key ? "active" : ""} aria-pressed={company === key} onClick={() => { setCompany(key); setConfirming(false); }}>{COMPANIES[key].short}</button>)}</div></div>

          <div className="counter-field"><span>Sale de</span><div className="counter-segment">{SOURCES.map(source => <button key={source.key} type="button" className={from === source.key ? "active" : ""} aria-pressed={from === source.key} onClick={() => { setFrom(source.key); setConfirming(false); }}>{source.label}</button>)}</div>
            <small className="field-hint">{sourceLabel.hint}</small></div>

          <label className="counter-field"><span>Cliente</span>
            <SearchSelect name="clientId" options={clientOptions} value={clientId} onChange={pickClient} placeholder="Consumidor final" createLabel="Dar de alta un cliente" onCreate={() => setCreatingClient(true)} />
            {client && <small className="field-hint">{[client.cuit && `CUIT ${client.cuit}`, client.vatCondition && VAT_CONDITIONS[client.vatCondition as VatCondition]?.label].filter(Boolean).join(" · ") || "Sin CUIT ni condición de IVA cargados"} · <button type="button" className="link-btn" onClick={() => pickClient("")}>Consumidor final</button></small>}
          </label>
          {creatingClient && <NewClient onCancel={() => setCreatingClient(false)} onCreate={form => { void createClient(form); }} />}

          <div className="counter-field"><span>Comprobante</span><div className="counter-segment">{VOUCHERS.map(entry => <button key={entry.key} type="button" className={voucher === entry.key ? "active" : ""} aria-pressed={voucher === entry.key} onClick={() => { setVoucher(entry.key); setConfirming(false); }}>{entry.label}</button>)}</div>
            <small className="field-hint">{fiscal ? "Se emite en ARCA con CAE al cobrar." : "Comprobante interno: no va a ARCA ni lleva IVA."}</small></div>

          <div className="counter-totals">
            <div><span>Productos</span><b>{lines.length}</b></div>
            <div><span>{fiscal ? "Neto sin IVA" : "Subtotal"}</span><b>{money(checked.netCents)}</b></div>
            {fiscal && <div><span>IVA 21 %</span><b>{money(checked.vatCents)}</b></div>}
            <div className="wide"><span>Total a cobrar</span><strong>{money(totalCents)}</strong></div>
          </div>

          <div className="counter-field"><span>Paga con</span><div className="counter-segment mostrador-methods">{METHODS.map(entry => <button key={entry.key} type="button" className={method === entry.key ? "active" : ""} aria-pressed={method === entry.key} onClick={() => { setMethod(entry.key); setConfirming(false); }}><entry.icon size={15} /> {entry.label}</button>)}</div></div>
          {method === "efectivo" && <label className="counter-field"><span>Con cuánto paga (para el vuelto)</span><div className="money-input"><span className="money-prefix">$</span><input inputMode="decimal" value={cashGiven} placeholder="0,00" onChange={event => setCashGiven(onlyAmount(event.target.value))} /></div>
            {changeCents > 0 && <small className="mostrador-change">Vuelto: <b>{money(changeCents)}</b></small>}</label>}
          <label className="counter-field"><span>Observaciones</span><textarea rows={2} value={note} onChange={event => setNote(event.target.value)} placeholder="Retira en el momento, envío…" /></label>
          {lines.length > 0 && problems.length > 0 && <p className="form-error">{problems[0]}</p>}
        </div>
        <footer>
          {confirming && <span className="counter-confirm-text">Se cobran {money(totalCents)} en {methodLabel(method).toLowerCase()} con {voucherName(voucher)}{fiscal ? " emitida en ARCA" : ""}, a {client?.name || "consumidor final"}.</span>}
          {confirming && <button type="button" className="secondary-btn" onClick={() => setConfirming(false)}>Volver</button>}
          <button type="button" className={confirming ? "primary-btn confirming" : "primary-btn"} disabled={saving || !ready} onClick={() => { void submit(); }}>
            {saving ? (fiscal ? "Emitiendo en ARCA…" : "Registrando…") : confirming ? <><Check size={16} /> Sí, cobrar</> : <><ReceiptText size={16} /> Cobrar {money(totalCents)}</>}
          </button>
        </footer>
      </div>
    </div>

    <section className="panel counter-recent">
      <div className="panel-head">
        <div><p className="eyebrow">CIERRE DEL DÍA</p><h2>Ventas del mostrador</h2><p>{dayData ? `${dayData.summary.count} ${dayData.summary.count === 1 ? "venta" : "ventas"} por ${money(dayData.summary.totalCents)}` : "Cargando…"}</p></div>
        <div className="mostrador-day"><DateInput name="day" defaultValue={day} onValueChange={value => { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { setDay(value); void loadDay(value); } }} /><Link className="secondary-btn" href="/app/invoices">Facturas de venta</Link></div>
      </div>
      {dayData && dayData.summary.count > 0 && <div className="mostrador-summary">
        {dayData.summary.byMethod.map(row => <div key={row.method}><span>{row.label}</span><b>{money(row.amountCents)}</b></div>)}
        {dayData.summary.byVoucher.map(row => <div key={row.voucherType} className="muted"><span>{voucherName(row.voucherType)}</span><b>{money(row.amountCents)}</b></div>)}
        {dayData.summary.pendingCents > 0 && <div className="warn"><span>Sin cobro registrado</span><b>{money(dayData.summary.pendingCents)}</b></div>}
      </div>}
      {!dayData?.items.length ? <p className="task-history-state">No hay ventas ese día.</p>
        : <div className="table-scroll"><table><thead><tr><th>Venta</th><th>Hora</th><th>Comprobante</th><th>Cliente</th><th>Productos</th><th>Cobro</th><th>Total</th><th>Atendió</th><th /></tr></thead><tbody>
          {dayData.items.map(sale => <tr key={sale._id}>
            <td data-label="Venta"><b>{sale.number}</b></td>
            <td data-label="Hora">{dateTime(sale.createdAt || sale.date).split(" ").pop()}</td>
            <td data-label="Comprobante">{sale.invoiceLabel || voucherName(sale.voucherType)}</td>
            <td data-label="Cliente">{sale.buyerName || sale.clientName || "—"}</td>
            <td data-label="Productos">{sale.lines.length}</td>
            <td data-label="Cobro">{sale.status === "sin_cobro" ? <span className="badge pendiente" title={sale.warning}>Sin cobro</span> : (sale.payments || []).map(payment => methodLabel(payment.method)).join(" + ")}</td>
            <td data-label="Total"><b>{money(sale.amountCents)}</b></td>
            <td data-label="Atendió">{sale.userName || "—"}</td>
            <td className="row-actions">
              <button title="Imprimir el ticket" onClick={() => { void printTicket(sale); }}><Printer size={16} /></button>
              <button title="Descargar la factura en PDF" onClick={() => { void downloadInvoice(sale); }}><FileDown size={16} /></button>
            </td>
          </tr>)}
        </tbody></table></div>}
    </section>

    {camera && <CameraScanner continuous onDetected={onCameraCode} onClose={closeCamera} title="Escanear lo que se vende" />}
  </>;
}


/** Alta rápida de un cliente con CUIT, sin salir de la venta. */
function NewClient({ onCreate, onCancel }: { onCreate: (form: FormData) => void; onCancel: () => void }) {
  return <form className="counter-manual" onSubmit={event => { event.preventDefault(); onCreate(new FormData(event.currentTarget)); }}>
    <legend><UserPlus size={13} /> Cliente nuevo</legend>
    <label className="counter-field"><span>Razón social o nombre *</span><input name="name" required autoFocus /></label>
    <div className="counter-manual-grid">
      <label className="counter-field"><span>CUIT *</span><input name="cuit" required inputMode="numeric" placeholder="30-12345678-9" /></label>
      <label className="counter-field"><span>Condición de IVA *</span><select name="vatCondition" required defaultValue="responsable_inscripto">{VAT_CONDITION_KEYS.map(key => <option key={key} value={key}>{VAT_CONDITIONS[key].label}</option>)}</select></label>
    </div>
    <label className="counter-field"><span>Domicilio</span><input name="address" /></label>
    <div className="counter-unknown-actions"><button type="button" className="secondary-btn" onClick={onCancel}>Cancelar</button><button className="primary-btn"><UserPlus size={16} /> Crear y elegir</button></div>
  </form>;
}
