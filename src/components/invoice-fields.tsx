"use client";

import { useEffect, useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import type { Field } from "@/lib/entity-config";
import { money } from "@/lib/format";
import { MoneyInput, SearchSelect } from "@/components/fields";
import { COMPANIES, COMPANY_KEYS, companyOf, type CompanyKey } from "@/lib/companies";
import { FormField, type FieldProps } from "@/components/record-form";
import { isCreditNote, isNote, voucherLabels } from "@/lib/invoice-labels";

type Item = Record<string, unknown> & { _id: string };

const VAT_RATES = [21, 10.5, 27, 0];
const groups = [
  { title: "Comprobante", description: "Facturas y notas A y B se emiten en ARCA con CAE (o se carga la que salió de Tango). La X es interna y se numera sola", keys: ["company", "voucherType", "number", "associatedInvoiceId", "issueDate", "dueDate"] },
  { title: "A qué corresponde", description: "La cotización completa sola el cliente y la obra", keys: ["quoteId", "clientId", "workId", "certificateNumber"] },
];

/**
 * El formulario de la factura. El total sale del neto y del IVA; una factura
 * vieja que se cargó solo con el total se sigue editando por el total, hasta
 * que se le cargue el neto.
 */
export function InvoiceFields({ fields, fieldProps, editing, draft, quotes, works, onRelations }: {
  fields: Field[]; fieldProps: (field: Field) => FieldProps; editing: Item | null; draft: Record<string, unknown>;
  quotes: Item[]; works: Item[]; onRelations: (patch: Record<string, string>) => void;
}) {
  const source = editing || draft;
  const [byTotal, setByTotal] = useState(() => Boolean(editing && !Number(editing.netCents) && Number(editing.amountCents)));
  const [net, setNet] = useState(() => Number(source.netCents || 0) / 100);
  const [vatPct, setVatPct] = useState(() => source.vatPct === undefined || source.vatPct === null || source.vatPct === "" ? 21 : Number(source.vatPct));
  // Qué comprobante es. La X no pasa por ARCA: no discrimina IVA y su número lo pone el sistema.
  const [voucherType, setVoucherType] = useState(() => String(source.voucherType || "factura_a"));
  const isX = voucherType === "factura_x";
  const vat = isX ? 0 : Math.round(net * vatPct) / 100;
  const total = Math.round((net + vat) * 100) / 100;
  const field = (key: string) => fields.find(candidate => candidate.key === key);
  // La empresa elegida y el número: en una factura nueva, el número sugerido es el que sigue en esa empresa.
  const [company, setCompany] = useState<CompanyKey>(() => companyOf(source.company).key);
  const [number, setNumber] = useState(() => String(source.number || ""));
  const [numberTouched, setNumberTouched] = useState(false);
  const suggested = (draft.numbers || {}) as Record<string, Record<string, string>>;
  const enabled = (draft.types || {}) as Record<string, string[]>;
  const pointsOfSale = (draft.pointsOfSale || {}) as Record<string, Record<string, string>>;
  // Las A y B de una empresa conectada a ARCA se emiten al guardar: el número lo pone ARCA, con el CAE.
  // También se puede cargar una que ya salió de Tango, con su número.
  const arca = (draft.arca || {}) as Record<string, boolean>;
  const canEmit = !editing && !isX && Boolean(arca[company]);
  const [emit, setEmit] = useState(true);
  const emitting = canEmit && emit;
  // El número viene bloqueado: el que sigue en ARCA (o en lo cargado, si es de Tango). "Editar" lo libera.
  const [numberLocked, setNumberLocked] = useState(true);
  const [numberHint, setNumberHint] = useState("");
  const [numberError, setNumberError] = useState("");
  // Una nota de débito o de crédito va asociada a una factura del mismo cliente y la misma letra.
  const note = isNote(voucherType);
  const clientField = field("clientId");
  const clientId = (clientField ? fieldProps(clientField).relationValue : "") || String(source.clientId || "");
  const [associatedId, setAssociatedId] = useState(() => String(source.associatedInvoiceId || ""));
  const [associable, setAssociable] = useState<Array<{ _id: string; label: string; pendingCents: number }> | null>(null);

  // Al emitir en ARCA, el número es el que sigue allá: se consulta cada vez que cambia la empresa o el comprobante.
  useEffect(() => {
    if (!emitting) return;
    let active = true;
    fetch(`/api/arca/next?empresa=${company}&tipo=${voucherType}`)
      .then(async response => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (!active) return;
        if (!ok) { setNumberError(body.error || "No se pudo consultar el número en ARCA"); setNumberHint(""); setNumber(current => numberLocked ? "" : current); return; }
        setNumberError("");
        setNumber(current => numberLocked ? body.next : current);
        setNumberHint(body.last ? `Último autorizado en ARCA: ${String(body.next).replace(/\d+$/, digits => String(body.last).padStart(digits.length, "0"))}` : "El primero de este punto de venta en ARCA");
      })
      .catch(() => { if (active) setNumberError("No se pudo consultar el número en ARCA"); });
    return () => { active = false; };
    // El número bloqueado se reemplaza; si se editó, se respeta lo tipeado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emitting, company, voucherType]);

  useEffect(() => {
    if (!note || !clientId) return;
    let active = true;
    const keep = editing?.associatedInvoiceId ? `&incluir=${String(editing.associatedInvoiceId)}` : "";
    fetch(`/api/invoices/associable?cliente=${clientId}&empresa=${company}&tipo=${voucherType}${keep}`)
      .then(response => response.ok ? response.json() : { items: [] })
      .then(body => { if (active) setAssociable(body.items || []); })
      .catch(() => { if (active) setAssociable([]); });
    return () => { active = false; };
  }, [note, clientId, company, voucherType, editing?.associatedInvoiceId]);
  // Los tipos que la empresa tiene habilitados en sus talonarios; al editar, también el que ya tiene.
  const typeOptions = [...new Set([...(enabled[company] || ["factura_a", "factura_b", "factura_x"]), ...(editing?.voucherType ? [String(editing.voucherType)] : [])])];

  function suggest(nextCompany: string, nextType: string) {
    if (!editing && (!numberTouched || nextType === "factura_x")) setNumber(suggested[nextCompany]?.[nextType] || "");
    setAssociatedId("");
  }

  /** El número, bloqueado hasta que se toca "Editar". */
  function numberInput(hint: string) {
    return <label><span>Número *<em className="field-hint">{numberError || (numberLocked ? hint : emitting ? "Al emitir tiene que ser el que sigue en ARCA" : "Punto de venta y número")}</em></span>
      <div className="number-lock">
        <input name="number" required readOnly={numberLocked} value={number} placeholder="0001-00000123" className={numberLocked ? "locked" : ""}
          onChange={event => { setNumber(event.target.value); setNumberTouched(true); }} />
        <button type="button" className="secondary-btn" onClick={() => setNumberLocked(locked => !locked)} title={numberLocked ? "Cambiar el número a mano" : "Volver a bloquearlo"}>
          {numberLocked ? <><Lock size={14} /> Editar</> : <><LockOpen size={14} /> Bloquear</>}
        </button>
      </div>
      <input type="hidden" name="pointOfSale" value={number.match(/^(\d{1,5})-/)?.[1] || pointsOfSale[company]?.[voucherType] || ""} /></label>;
  }

  function chooseCompany(value: string) {
    const next = companyOf(value).key;
    setCompany(next);
    const type = (enabled[next] || []).includes(voucherType) || !enabled[next]?.length ? voucherType : enabled[next][0];
    setVoucherType(type);
    suggest(next, type);
  }

  function chooseType(value: string) {
    setVoucherType(value);
    suggest(company, value);
  }

  function renderField(key: string, autoFocus: boolean) {
    const target = field(key);
    if (!target) return null;
    if (key === "company") return <label key={key}><span>Empresa que factura *</span>
      <SearchSelect name="company" value={company} onChange={chooseCompany} required autoFocus={autoFocus}
        options={COMPANY_KEYS.map(option => ({ value: option, label: COMPANIES[option].legalName, hint: `CUIT ${COMPANIES[option].cuit}` }))} /></label>;
    if (key === "voucherType") return <label key={key}><span>Tipo *<em className="field-hint">Los que {companyOf(company).short} tiene habilitados</em></span>
      <select name="voucherType" value={voucherType} onChange={event => chooseType(event.target.value)} disabled={Boolean(editing)} required>
        {typeOptions.map(option => <option key={option} value={option}>{option === "factura_x" ? "Factura X (interna, no fiscal)" : voucherLabels[option] || option}</option>)}
      </select>{editing && <input type="hidden" name="voucherType" value={voucherType} />}</label>;
    // La X se numera sola desde su talonario: se muestra, no se tipea.
    if (key === "number" && isX) return <label key={key} className="readonly-field"><span>Número<em className="field-hint">{editing ? "Numeración interna" : "Lo pone el sistema al guardar"}</em></span>
      <output>{(number || "X-…").replace(/^X-/, "X ")}</output><input type="hidden" name="number" value={editing ? number : ""} /><input type="hidden" name="pointOfSale" value={pointsOfSale[company]?.factura_x || "0001"} /></label>;
    // Emitida en ARCA: el número y el CAE quedan como están.
    if (key === "number" && editing?.cae) return <label key={key} className="readonly-field"><span>Número<em className="field-hint">Emitida en ARCA</em></span>
      <output>{number} · CAE {String(editing.cae)}</output><input type="hidden" name="number" value={number} /><input type="hidden" name="pointOfSale" value={String(editing.pointOfSale || "")} /></label>;
    if (key === "number" && canEmit) return <div key={key} className="invoice-arca-choice">
      <label><span>¿Cómo se emite? *</span><select name="arcaEmit" value={emit ? "1" : ""} onChange={event => setEmit(event.target.value === "1")}>
        <option value="1">Emitir ahora en ARCA (con CAE)</option>
        <option value="">Ya la emití en Tango: cargo el número</option>
      </select></label>
      {numberInput(emitting ? numberHint || "Consultando el que sigue en ARCA…" : "El que sigue en lo cargado de Tango")}
    </div>;
    if (key === "number") return <div key={key} className="invoice-arca-choice">{numberInput(editing ? "Punto de venta y número" : `El que sigue en ${companyOf(company).short}`)}</div>;
    if (key === "associatedInvoiceId") {
      if (!note) return null;
      if (editing?.cae || (editing && isCreditNote(voucherType))) return <label key={key} className="readonly-field"><span>Factura asociada<em className="field-hint">No se cambia</em></span>
        <output>{associable?.find(option => option._id === associatedId)?.label || "—"}</output><input type="hidden" name="associatedInvoiceId" value={associatedId} /></label>;
      return <label key={key}><span>Factura asociada *<em className="field-hint">{!clientId ? "Elegí primero el cliente" : isCreditNote(voucherType) ? "La nota descuenta de lo que se debe de esta factura" : "A la que corresponde la nota"}</em></span>
        <select name="associatedInvoiceId" required value={associatedId} onChange={event => setAssociatedId(event.target.value)} disabled={!clientId}>
          <option value="">{associable === null ? "—" : associable.length ? "Elegí la factura" : `El cliente no tiene ${isCreditNote(voucherType) ? "facturas con saldo" : "facturas"} de esta letra`}</option>
          {(associable || []).map(option => <option key={option._id} value={option._id}>{option.label}{isCreditNote(voucherType) ? ` · debe ${money(option.pendingCents)}` : ""}</option>)}
        </select></label>;
    }
    return <FormField key={key} {...props(target)} autoFocus={autoFocus} />;
  }

  function props(target: Field): FieldProps {
    const base = fieldProps(target);
    if (target.key !== "quoteId") return base;
    // Al elegir la cotización se completan el cliente y la obra que salió de ella.
    return { ...base, onRelationChange: (value: string) => {
      const quote = quotes.find(candidate => candidate._id === value);
      const work = works.find(candidate => String(candidate.quoteId || "") === value) || works.find(candidate => candidate._id === String(quote?.workId || ""));
      if (quote?.company) chooseCompany(String(quote.company));
      onRelations({ quoteId: value, ...(quote?.clientId ? { clientId: String(quote.clientId) } : {}), ...(work ? { workId: work._id } : {}) });
    } };
  }

  return <div className="work-form-sections">
    {groups.map((group, groupIndex) => <fieldset key={group.title}><legend><b>{group.title}</b><small>{group.description}</small></legend><div className="form-grid">
      {group.keys.map((key, index) => renderField(key, groupIndex === 0 && index === 0))}
    </div></fieldset>)}

    {/* Los campos ocultos del formulario genérico: a qué X sustituye y qué remitos factura. */}
    {["replacesId", "remitoIds"].map(key => { const target = field(key); return target ? <FormField key={key} {...fieldProps(target)} /> : null; })}
    {emitting && <p className="invoice-note">Al guardar se emite en ARCA: ARCA le da el número y el CAE, y el comprobante queda autorizado. Después no se puede borrar ni cambiar el cliente, la fecha o los importes; para anular una factura hace falta una nota de crédito.</p>}
    {note && isCreditNote(voucherType) && <p className="invoice-note">La nota de crédito resta: baja lo que el cliente debe de la factura asociada, y resta en ventas, libro IVA y reportes.</p>}
    {Boolean(editing?.cae) && <p className="invoice-note">Emitida en ARCA ({editing?.arcaEnvironment === "homologacion" ? "homologación, de prueba" : "producción"}) · CAE {String(editing?.cae)}. Solo se puede cambiar lo que no es fiscal: obra, cotización, descripción y vencimiento.</p>}
    {Boolean(source.replacesId) && <p className="invoice-note">Sustituye a una Factura X: al guardar, la X queda como sustituida y lo que ya se cobró de ella pasa a esta factura.</p>}

    <fieldset><legend><b>Importes</b><small>{isX ? "La X no discrimina IVA: el total es el importe" : byTotal ? "Esta factura se cargó solo con el total" : "El IVA y el total salen del neto"}</small></legend><div className="form-grid">
      {byTotal ? <>
        <label><span>Total *</span><MoneyInput name="amountCents" defaultValue={Number(source.amountCents || 0) / 100} required /></label>
        <label className="readonly-field"><span>Neto e IVA</span><output><button type="button" className="link-btn" onClick={() => { setByTotal(false); setNet(Math.round(Number(source.amountCents || 0) / (1 + vatPct / 100)) / 100); }}>Cargar el neto y el IVA</button></output></label>
      </> : <>
        <label><span>{isX ? "Importe *" : "Neto gravado *"}</span><MoneyInput key={`net-${byTotal}`} name="netCents" defaultValue={net} required onValueChange={setNet} /></label>
        {isX ? <input type="hidden" name="vatPct" value="0" /> : <>
        <label><span>IVA</span><select name="vatPct" value={String(vatPct)} onChange={event => setVatPct(Number(event.target.value))}>
          {VAT_RATES.map(rate => <option key={rate} value={rate}>{rate ? `${String(rate).replace(".", ",")} %` : "Sin IVA"}</option>)}
        </select></label>
        <label className="readonly-field"><span>IVA</span><output>{money(Math.round(vat * 100))}</output></label></>}
        <label className="readonly-field"><span>Total</span><output><b>{money(Math.round(total * 100))}</b></output><input type="hidden" name="amountCents" value={total || ""} /></label>
      </>}
      {field("collectedCents") && editing && <FormField {...fieldProps(field("collectedCents")!)} />}
      {field("status") && <FormField {...fieldProps(field("status")!)} />}
    </div></fieldset>

    <fieldset><legend><b>Detalle</b><small>Descripción y el PDF de la factura</small></legend><div className="form-grid">
      {["description", "attachment"].map(key => { const target = field(key); return target ? <FormField key={key} {...fieldProps(target)} /> : null; })}
    </div></fieldset>
  </div>;
}
