"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Field } from "@/lib/entity-config";
import { money } from "@/lib/format";
import { FormField, type FieldProps } from "@/components/record-form";
import { PURCHASE_PERCEPTIONS, pctLabel, purchaseTotals, storedPurchaseTaxes, voucherTaxFields } from "@/lib/purchase-taxes";
import { baseInvoiceType } from "@/lib/invoice-labels";

type Item = Record<string, unknown> & { _id: string };
type Rates = { perceptionVatPct: number; perceptionIibbPct: number; perceptionIibbProvPct: number; internalTaxPct: number };

/** Los campos del formulario no son controlados: se leen del formulario cada vez que algo cambia. */
function useFormValues(wrap: RefObject<HTMLDivElement | null>) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const node = wrap.current;
    const form = node?.closest("form");
    if (!node || !form) return;
    let timer = 0;
    const read = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setValues(Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, String(value)]))), 0);
    };
    read();
    const events = ["input", "change", "click", "keyup"];
    for (const type of events) node.addEventListener(type, read);
    return () => { window.clearTimeout(timer); for (const type of events) node.removeEventListener(type, read); };
  }, [wrap]);
  const number = (key: string) => { const value = Number(String(values[key] ?? "").replace(",", ".")); return Number.isFinite(value) && value > 0 ? value : 0; };
  return { values, number };
}

const ratesOf = (number: (key: string) => number): Rates => ({ perceptionVatPct: number("perceptionVatPct"), perceptionIibbPct: number("perceptionIibbPct"), perceptionIibbProvPct: number("perceptionIibbProvPct"), internalTaxPct: number("internalTaxPct") });

/** Del neto al total, renglón por renglón. */
function TaxPreview({ netCents, vatRows, rates, amounts, totalLabel }: {
  netCents: number; vatRows: Array<{ pct: number; vatCents: number }>; rates: Rates;
  amounts: { perceptionVatCents: number; perceptionIibbCents: number; perceptionIibbProvCents: number; internalTaxCents: number; amountCents: number }; totalLabel: string;
}) {
  return <dl className="purchase-taxes-preview" aria-live="polite">
    <div><dt>Neto (sin IVA)</dt><dd>{money(netCents)}</dd></div>
    {vatRows.map(row => <div key={row.pct}><dt>IVA {pctLabel(row.pct)}</dt><dd>{money(row.vatCents)}</dd></div>)}
    {PURCHASE_PERCEPTIONS.map(({ key, label }) => rates[`${key}Pct`] > 0 && <div key={key}><dt>{label} {pctLabel(rates[`${key}Pct`])}</dt><dd>{money(amounts[`${key}Cents`])}</dd></div>)}
    {rates.internalTaxPct > 0 && <div><dt>Impuesto interno {pctLabel(rates.internalTaxPct)}</dt><dd>{money(amounts.internalTaxCents)}</dd></div>}
    <div className="total"><dt>{totalLabel}</dt><dd>{money(amounts.amountCents)}</dd></div>
  </dl>;
}

/**
 * El formulario de la solicitud de compra cargada a mano. El total no se
 * escribe: se ve en vivo con el neto, el IVA, las percepciones y el impuesto
 * interno, y lo vuelve a calcular el servidor al guardar. El plazo aparece
 * sólo a plazo y el medio de pago sólo de contado. Una solicitud de antes,
 * que tenía sólo el total con IVA, se abre con el neto que sale de ese total.
 */
export function PurchaseFields({ fields, fieldProps, editing }: { fields: Field[]; fieldProps: (field: Field) => FieldProps; editing: Item | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const stored = editing ? storedPurchaseTaxes(editing) : null;
  const { values, number } = useFormValues(wrap);

  const terms = values.paymentTerms || String(editing?.paymentTerms || "contado");
  const shown = fields.filter(field => !field.readOnly && !(field.key === "termDays" && terms !== "plazo") && !(field.key === "cashMethod" && terms !== "contado"));
  const rates = ratesOf(number);
  const totals = purchaseTotals([{ totalCents: Math.round(number("subtotalCents") * 100) }], { ...rates, vatPct: number("vatPct") || stored?.vatPct });

  const props = (field: Field) => {
    const base = fieldProps(field);
    // Una de antes no tiene el neto ni la alícuota guardados: se muestran los que valen.
    if (stored && field.key === "subtotalCents") return { ...base, value: stored.subtotalCents };
    if (stored && field.key === "vatPct") return { ...base, value: String(stored.vatPct) };
    return base;
  };

  return <div className="form-grid" ref={wrap}>
    {shown.map((field, index) => <FormField key={field.key} {...props(field)} autoFocus={index === 0} />)}
    <TaxPreview netCents={totals.subtotalCents} vatRows={totals.vatByRate} rates={rates} amounts={totals} totalLabel="Total de la solicitud" />
  </div>;
}

/**
 * El formulario de la factura de compra. Con el neto cargado, el total sale
 * del neto, el IVA (sólo en la A y sus notas), las percepciones y el impuesto
 * interno, y se ve en vivo; sin neto (un costo interno, una factura de antes)
 * se carga el total.
 */
export function ExpenseFields({ fields, fieldProps }: { fields: Field[]; fieldProps: (field: Field) => FieldProps }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { values, number } = useFormValues(wrap);
  const net = Math.round(number("netCents") * 100);
  const voucherType = values.voucherType || "";
  const withVat = Boolean(voucherType) && baseInvoiceType(voucherType) === "factura_a";
  const rates = ratesOf(number);
  const amounts = voucherTaxFields(net, { ...rates, vatPct: values.vatPct === undefined || values.vatPct === "" ? undefined : number("vatPct") }, withVat);

  return <div className="form-grid" ref={wrap}>
    {fields.map((field, index) => <FormField key={field.key} {...fieldProps(field)} autoFocus={index === 0} />)}
    {net > 0 && <TaxPreview netCents={net} vatRows={withVat ? [{ pct: amounts.vatPct, vatCents: amounts.vatCents }] : []} rates={rates} amounts={amounts} totalLabel="Total del comprobante (se guarda este)" />}
  </div>;
}
