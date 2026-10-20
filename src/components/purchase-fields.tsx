"use client";

import { useEffect, useRef, useState } from "react";
import type { Field } from "@/lib/entity-config";
import { money } from "@/lib/format";
import { FormField, type FieldProps } from "@/components/record-form";
import { PURCHASE_PERCEPTIONS, pctLabel, purchaseTotals, storedPurchaseTaxes } from "@/lib/purchase-taxes";

type Item = Record<string, unknown> & { _id: string };

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
  const [values, setValues] = useState<Record<string, string>>({});

  // Los campos del formulario no son controlados: se leen del formulario cada vez que algo cambia.
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
    for (const type of ["input", "change", "click", "keyup"]) node.addEventListener(type, read);
    return () => { window.clearTimeout(timer); for (const type of ["input", "change", "click", "keyup"]) node.removeEventListener(type, read); };
  }, []);

  const terms = values.paymentTerms || String(editing?.paymentTerms || "contado");
  const shown = fields.filter(field => !field.readOnly && !(field.key === "termDays" && terms !== "plazo") && !(field.key === "cashMethod" && terms !== "contado"));
  const number = (key: string) => { const value = Number(String(values[key] ?? "").replace(",", ".")); return Number.isFinite(value) && value > 0 ? value : 0; };
  const rates = { vatPct: number("vatPct") || stored?.vatPct, perceptionVatPct: number("perceptionVatPct"), perceptionIibbPct: number("perceptionIibbPct"), perceptionIibbProvPct: number("perceptionIibbProvPct"), internalTaxPct: number("internalTaxPct") };
  const totals = purchaseTotals([{ totalCents: Math.round(number("subtotalCents") * 100) }], rates);

  const props = (field: Field) => {
    const base = fieldProps(field);
    // Una de antes no tiene el neto ni la alícuota guardados: se muestran los que valen.
    if (stored && field.key === "subtotalCents") return { ...base, value: stored.subtotalCents };
    if (stored && field.key === "vatPct") return { ...base, value: String(stored.vatPct) };
    return base;
  };

  return <div className="form-grid" ref={wrap}>
    {shown.map((field, index) => <FormField key={field.key} {...props(field)} autoFocus={index === 0} />)}
    <dl className="purchase-taxes-preview" aria-live="polite">
      <div><dt>Neto (sin IVA)</dt><dd>{money(totals.subtotalCents)}</dd></div>
      {totals.vatByRate.map(row => <div key={row.pct}><dt>IVA {pctLabel(row.pct)}</dt><dd>{money(row.vatCents)}</dd></div>)}
      {PURCHASE_PERCEPTIONS.map(({ key, label }) => rates[`${key}Pct`] > 0 && <div key={key}><dt>{label} {pctLabel(rates[`${key}Pct`])}</dt><dd>{money(totals[`${key}Cents`])}</dd></div>)}
      {rates.internalTaxPct > 0 && <div><dt>Impuesto interno {pctLabel(rates.internalTaxPct)}</dt><dd>{money(totals.internalTaxCents)}</dd></div>}
      <div className="total"><dt>Total de la solicitud</dt><dd>{money(totals.amountCents)}</dd></div>
    </dl>
  </div>;
}
