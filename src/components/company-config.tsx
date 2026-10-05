"use client";

import { useEffect, useState } from "react";
import { Building2, Plus, Warehouse } from "lucide-react";
import { COMPANIES, COMPANY_KEYS, type CompanyKey } from "@/lib/companies";
import { WAREHOUSES } from "@/lib/warehouses";
import { formatVoucherNumber, voucherLabels, VOUCHER_TYPES } from "@/lib/invoice-labels";
import type { VoucherBookRow } from "@/lib/voucher-books";

/**
 * Configuración de las dos empresas: sus datos, los talonarios de comprobantes
 * (qué tipos usa para vender y para comprar, en qué punto de venta) y los
 * depósitos. Nada fijo: un punto de venta nuevo o un tipo que se empieza a usar
 * se agrega acá.
 */
export function CompanyConfig() {
  const [books, setBooks] = useState<VoucherBookRow[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const response = await fetch("/api/voucher-books");
    const body = await response.json();
    if (response.ok) setBooks(body.items); else { setBooks([]); setError(body.error || "No se pudieron leer los talonarios"); }
  }
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, []);

  async function patch(book: VoucherBookRow, changes: Partial<VoucherBookRow>) {
    setBusy(book._id); setError(""); setNotice("");
    const response = await fetch(`/api/voucher-books/${book._id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) });
    const body = await response.json();
    setBusy("");
    if (!response.ok) return setError(body.error || "No se pudo guardar");
    setNotice("Talonario actualizado.");
    void load();
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    setBusy("new"); setError(""); setNotice("");
    const response = await fetch("/api/voucher-books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
    const body = await response.json();
    setBusy("");
    if (!response.ok) return setError(body.error || "No se pudo crear el talonario");
    setNotice("Talonario agregado.");
    element.reset();
    void load();
  }

  function askNumber(book: VoucherBookRow) {
    const answer = prompt(`¿Desde qué número sigue la Factura X de ${COMPANIES[book.company].short} (punto de venta ${book.pointOfSale})? El último usado es ${book.lastNumber}.`, String(book.lastNumber + 1));
    if (answer === null) return;
    const next = Number(answer.replace(/\D/g, ""));
    if (!next) return setError("Poné un número válido");
    void patch(book, { lastNumber: next - 1 });
  }

  const companyBooks = (company: CompanyKey) => (books || []).filter(book => book.company === company);

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">CONFIGURACIÓN</p>
      <h1>Empresas y comprobantes</h1>
      <p>Cualquiera de las dos empresas puede comprar y cualquiera puede facturar: el sistema no ata una con la otra. Acá se define qué comprobantes usa cada una y en qué punto de venta.</p>
    </div></div>
    {error && <div className="notice error">{error}</div>}
    {notice && <div className="notice success" role="status">{notice}</div>}

    <div className="config-companies">
      {COMPANY_KEYS.map(key => {
        const company = COMPANIES[key];
        return <section key={key} className="table-panel config-company">
          <header><span className={`company-badge ${key}`}>{company.short}</span><div><h2><Building2 size={17} /> {company.legalName}</h2><small>CUIT {company.cuit}{company.vat ? ` · ${company.vat}` : ""} · {company.address}</small></div></header>
          {books === null ? <div className="loading-state">Cargando…</div> : <div className="table-scroll"><table><thead><tr><th>Uso</th><th>Comprobante</th><th>Punto de venta</th><th>Numeración</th><th>Estado</th><th /></tr></thead><tbody>
            {companyBooks(key).map(book => <tr key={book._id} className={book.active ? "" : "row-inactive"}>
              <td data-label="Uso">{book.scope === "venta" ? "Venta" : "Compra"}</td>
              <td data-label="Comprobante"><b>{voucherLabels[book.voucherType]}</b><small className="tracking-sub">{book.fiscal ? "Fiscal · pasa por ARCA" : "Interno · no fiscal"}</small></td>
              <td data-label="Punto de venta">{book.scope === "venta" ? book.pointOfSale : "—"}</td>
              <td data-label="Numeración">{book.scope === "compra" ? "La del proveedor" : book.fiscal ? "La de Tango / ARCA" : <>Próxima: <b>X {formatVoucherNumber(book.pointOfSale, book.lastNumber + 1)}</b></>}</td>
              <td data-label="Estado"><span className={`badge ${book.active ? "activo" : "anulada"}`}>{book.active ? "Habilitado" : "Deshabilitado"}</span></td>
              <td className="row-actions">
                {!book.fiscal && book.scope === "venta" && <button className="row-action-wide" disabled={busy === book._id} onClick={() => askNumber(book)}>Numeración</button>}
                <button className="row-action-wide" disabled={busy === book._id} onClick={() => { void patch(book, { active: !book.active }); }}>{book.active ? "Deshabilitar" : "Habilitar"}</button>
              </td>
            </tr>)}
          </tbody></table></div>}
        </section>;
      })}
    </div>

    <section className="table-panel config-new-book">
      <header><h2><Plus size={17} /> Agregar un talonario</h2><small>Otro punto de venta, o un tipo de comprobante que la empresa empieza a usar.</small></header>
      <form className="form-grid" onSubmit={event => { void create(event); }}>
        <label><span>Empresa *</span><select name="company" required>{COMPANY_KEYS.map(key => <option key={key} value={key}>{COMPANIES[key].legalName}</option>)}</select></label>
        <label><span>Uso *</span><select name="scope" required><option value="venta">Venta</option><option value="compra">Compra</option></select></label>
        <label><span>Comprobante *</span><select name="voucherType" required>{VOUCHER_TYPES.map(type => <option key={type} value={type}>{voucherLabels[type]}{type === "factura_x" ? " (interna)" : ""}</option>)}</select></label>
        <label><span>Punto de venta *</span><input name="pointOfSale" required defaultValue="0002" inputMode="numeric" /></label>
        <div className="form-actions"><button className="primary-btn" disabled={busy === "new"}><Plus size={16} /> Agregar</button></div>
      </form>
    </section>

    <section className="table-panel config-warehouses">
      <header><h2><Warehouse size={17} /> Depósitos</h2><small>Toda compra entra al Depósito Central. Al Salón de Ventas el material llega por transferencia desde el Central, y desde el Salón sale el remito al cliente.</small></header>
      <ul>{WAREHOUSES.map(warehouse => <li key={warehouse.key}><b>{warehouse.label}</b><span>{warehouse.key === "central" ? "Recibe las compras, guarda y prepara lo que va a obra o al salón" : "Recibe transferencias del Central y despacha al cliente con remito"}</span></li>)}</ul>
    </section>
  </>;
}
