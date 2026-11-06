"use client";

import { Plus, Trash2 } from "lucide-react";
import { MoneyInput, SearchSelect } from "@/components/fields";
import { CashAccountSelect } from "@/components/cash-account-select";
import { date, money } from "@/lib/format";
import { accountTypesFor, cashMethodLabels, COLLECTION_METHODS, METHODS_NEEDING_ATTACHMENT, OWN_CHECK_METHODS, PAYMENT_METHODS } from "@/lib/cash-methods";
import type { CarteraCheck } from "@/lib/check-service";

/*
 * Los medios de una OP o de un recibo (anexo de Tesorería v5.1): uno o varios,
 * cada uno con su caja o cuenta, su importe y lo que pida (el cheque, el
 * comprobante). Con un solo medio, el importe es el total; con varios, se
 * reparte y se muestra la diferencia.
 */

export type EditableLine = {
  key: number; method: string; cashAccountId: string; pesos: number; reference: string;
  /** El cheque: el propio (número, banco, fecha de cobro) o, en un recibo, el recibido (además, quién lo emitió). */
  check: { number: string; bank: string; dueDate: string; issuer: string };
  /** El de terceros de la cartera que se endosa. */
  checkId: string;
  /** El comprobante ya subido y el que se va a subir. */
  attachment: string; file: File | null;
};

let nextKey = 1;
export const newLine = (method = "transferencia", pesos = 0, rest: Partial<EditableLine> = {}): EditableLine => ({
  key: nextKey++, method, cashAccountId: "", pesos, reference: "", check: { number: "", bank: "", dueDate: "", issuer: "" }, checkId: "", attachment: "", file: null, ...rest,
});

/** Las líneas guardadas de una OP o un recibo (o su único medio, si es de antes), para editarlas. */
export function linesFrom(record: Record<string, unknown> | null | undefined, totalCents: number, checks: Record<string, { number: string; bank: string; dueDate: string; issuer?: string }> = {}): EditableLine[] {
  if (!record) return [newLine()];
  const saved = Array.isArray(record.lines) && record.lines.length ? record.lines as Array<Record<string, unknown>>
    : record.method ? [{ method: record.method, cashAccountId: record.cashAccountId, amountCents: totalCents, reference: record.reference, attachment: record.attachment, checkId: record.checkId }] : [];
  if (!saved.length) return [newLine()];
  return saved.map(line => {
    const check = line.checkId ? checks[String(line.checkId)] : undefined;
    const own = OWN_CHECK_METHODS.has(String(line.method));
    return newLine(String(line.method || "transferencia"), Number(line.amountCents || 0) / 100, {
      cashAccountId: String(line.cashAccountId || ""), reference: String(line.reference || ""), attachment: String(line.attachment || ""),
      checkId: line.method === "cheque_tercero" ? String(line.checkId || "") : "",
      check: own && check ? { number: check.number, bank: check.bank, dueDate: check.dueDate.slice(0, 10), issuer: check.issuer || "" } : { number: "", bank: "", dueDate: "", issuer: "" },
    });
  });
}

export const linesCents = (lines: EditableLine[]) => lines.reduce((total, line) => total + Math.round(line.pesos * 100), 0);

async function upload(file: File | null) {
  if (!file || !file.size) return "";
  const form = new FormData(); form.set("file", file);
  const response = await fetch("/api/uploads", { method: "POST", body: form });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo subir el comprobante");
  return String(body.path);
}

/** Sube los comprobantes elegidos y arma lo que se manda a la API. Con un solo medio, su importe es el total. */
export async function linesPayload(lines: EditableLine[], side: "pago" | "cobro", totalCents: number) {
  return Promise.all(lines.map(async line => {
    const attachment = (await upload(line.file)) || line.attachment;
    const hasCheck = line.check.number.trim() && line.check.bank.trim() && line.check.dueDate;
    const ownCheck = side === "pago" && OWN_CHECK_METHODS.has(line.method);
    const receivedCheck = side === "cobro" && OWN_CHECK_METHODS.has(line.method);
    return {
      method: line.method, cashAccountId: line.cashAccountId, amountCents: lines.length === 1 ? totalCents : Math.round(line.pesos * 100),
      reference: line.reference, attachment,
      ...(ownCheck && hasCheck ? { check: { number: line.check.number, bank: line.check.bank, dueDate: line.check.dueDate } } : {}),
      ...(receivedCheck && hasCheck ? { check: { number: line.check.number, bank: line.check.bank, dueDate: line.check.dueDate, issuer: line.check.issuer } } : {}),
      ...(line.method === "cheque_tercero" ? { checkId: line.checkId } : {}),
    };
  }));
}

/** Lo que le falta a un medio antes de mandarlo, o nada. */
export function lineProblem(line: EditableLine, side: "pago" | "cobro", required: boolean) {
  const label = cashMethodLabels[line.method].toLowerCase();
  if (line.method === "cheque_tercero" && !line.checkId) return "Elegí el cheque de terceros de la cartera";
  if (!required) return "";
  if (!line.cashAccountId && line.method !== "cheque_tercero") return `Elegí la caja o cuenta de la ${label}`;
  if (OWN_CHECK_METHODS.has(line.method) && (!line.check.number.trim() || !line.check.bank.trim() || !line.check.dueDate)) return `Poné el número, el banco y la fecha de cobro del ${label}`;
  if (side === "pago" && METHODS_NEEDING_ATTACHMENT.has(line.method) && !line.file && !line.attachment) return `Adjuntá el comprobante de la ${label}`;
  return "";
}

export function CashLinesEditor({ side, lines, onChange, company, totalCents, cartera = [] }: {
  side: "pago" | "cobro"; lines: EditableLine[]; onChange: (lines: EditableLine[]) => void; company?: string; totalCents: number; cartera?: CarteraCheck[];
}) {
  const methods = side === "pago" ? PAYMENT_METHODS : COLLECTION_METHODS;
  const single = lines.length === 1;
  const update = (key: number, patch: Partial<EditableLine>) => onChange(lines.map(line => line.key === key ? { ...line, ...patch } : line));
  // Los cheques de terceros que se pueden endosar: de la empresa y no elegidos en otra línea.
  const usable = (line: EditableLine) => cartera.filter(check => (!company || !check.company || check.company === company || check.company === "ambas") && (check._id === line.checkId || !lines.some(other => other.checkId === check._id)));
  const distributed = single ? totalCents : linesCents(lines);

  return <div className="cash-lines">
    <div className="receipt-table-head"><b>{side === "pago" ? "Con qué se paga" : "Con qué se cobró"}</b><span>
      <button type="button" className="link-btn" onClick={() => onChange([...lines, newLine("transferencia", single ? 0 : Math.max(0, totalCents - distributed) / 100)])}><Plus size={14} /> Agregar medio</button>
    </span></div>
    {lines.map(line => {
      const types = accountTypesFor(line.method, side);
      const ownCheck = OWN_CHECK_METHODS.has(line.method);
      return <div className="cash-line" key={line.key}>
        <label><span>Medio</span><select value={line.method} onChange={event => update(line.key, { method: event.target.value, cashAccountId: "", checkId: "" })}>
          {methods.map(method => <option key={method} value={method}>{cashMethodLabels[method]}</option>)}
        </select></label>
        {line.method === "cheque_tercero"
          ? <label className="cash-line-wide"><span>Cheque de la cartera</span><SearchSelect name={`check-${line.key}`} value={line.checkId} placeholder="Elegí el cheque…"
            options={usable(line).map(check => ({ value: check._id, label: `${check.number} · ${money(check.amountCents)}`, hint: [check.bank, `cobro ${date(check.dueDate)}`, check.client || check.issuer].filter(Boolean).join(" · ") }))}
            onChange={value => { const check = cartera.find(row => row._id === value); update(line.key, { checkId: value, pesos: check ? check.amountCents / 100 : line.pesos }); }} /></label>
          : <label className="cash-line-wide"><span>{side === "pago" ? (ownCheck ? "Banco o cuenta de cheques diferidos" : "Sale de") : "Entra en"}</span>
            <CashAccountSelect name={`account-${line.key}`} value={line.cashAccountId} onChange={value => update(line.key, { cashAccountId: value })} company={company}
              types={side === "pago" && ownCheck ? ["cheques_diferidos", "cuenta_corriente", "caja_ahorro"] : types} /></label>}
        <label><span>Importe</span>{single || line.method === "cheque_tercero"
          ? <output>{money(single ? totalCents : Math.round(line.pesos * 100))}</output>
          : <MoneyInput name={`amount-${line.key}`} defaultValue={line.pesos} onValueChange={value => update(line.key, { pesos: value })} />}</label>
        {ownCheck && <>
          <label><span>N° de {line.method === "echeq" ? "e-Cheq" : "cheque"}</span><input value={line.check.number} onChange={event => update(line.key, { check: { ...line.check, number: event.target.value } })} /></label>
          <label><span>Banco del cheque</span><input value={line.check.bank} onChange={event => update(line.key, { check: { ...line.check, bank: event.target.value } })} placeholder="Banco de Corrientes…" /></label>
          <label><span>Fecha de cobro</span><input type="date" value={line.check.dueDate} onChange={event => update(line.key, { check: { ...line.check, dueDate: event.target.value } })} /></label>
          {side === "cobro" && <label><span>Emisor</span><input value={line.check.issuer} onChange={event => update(line.key, { check: { ...line.check, issuer: event.target.value } })} placeholder="Quién lo libró" /></label>}
        </>}
        {!ownCheck && line.method !== "cheque_tercero" && <label><span>Referencia</span><input value={line.reference} onChange={event => update(line.key, { reference: event.target.value })} placeholder={line.method === "transferencia" ? "N° de transferencia…" : ""} /></label>}
        {(side === "pago" || line.method === "transferencia") && line.method !== "cheque_tercero" && <label className="cash-line-wide"><span>Comprobante{side === "pago" && METHODS_NEEDING_ATTACHMENT.has(line.method) ? " *" : ""}{line.attachment && !line.file ? <em className="field-hint">Ya tiene uno: elegí otro para cambiarlo</em> : null}</span>
          <input type="file" accept="image/*,application/pdf" onChange={event => update(line.key, { file: event.target.files?.[0] || null })} /></label>}
        {lines.length > 1 && <button type="button" className="icon-btn cash-line-remove" onClick={() => onChange(lines.filter(other => other.key !== line.key))} aria-label="Quitar este medio"><Trash2 size={16} /></button>}
      </div>;
    })}
    {!single && <dl className="payment-order-totals">
      <div><dt>{side === "pago" ? "Total de la OP" : "Total a cobrar"}</dt><dd>{money(totalCents)}</dd></div>
      <div><dt>Total en medios</dt><dd>{money(distributed)}</dd></div>
      <div className={distributed === totalCents ? "" : "warning-line"}><dt>Diferencia</dt><dd>{money(totalCents - distributed)}</dd></div>
    </dl>}
  </div>;
}
