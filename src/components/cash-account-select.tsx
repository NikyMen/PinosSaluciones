"use client";

import { useEffect, useState } from "react";
import { SearchSelect, type Option } from "@/components/fields";
import { type CompanyKey } from "@/lib/companies";
import { cashAccountCompanyShort, cashAccountServes, cashAccountTypeLabels } from "@/lib/cash-account-kinds";

export type CashAccountRow = { _id: string; code?: number; name: string; company: CompanyKey | "ambas"; type: string; bank?: string; currency?: string; active?: boolean };

// El maestro cambia poco: se pide una vez por pantalla y lo comparten todos los selects.
let cache: Promise<CashAccountRow[]> | null = null;

function loadCashAccounts() {
  cache ??= fetch("/api/records/cashAccounts?limit=100")
    .then(response => response.ok ? response.json() as Promise<{ items?: CashAccountRow[] }> : { items: [] })
    .then(result => result.items || [])
    .catch(() => { cache = null; return []; });
  return cache;
}

/** Después de dar de alta o cambiar una cuenta, los selects la vuelven a pedir. */
export function forgetCashAccounts() { cache = null; }

/**
 * Las cajas y cuentas bancarias activas del maestro, para elegir, por código
 * (como en TANGO: se escribe el número y Enter). No se crea una escribiendo un
 * nombre nuevo: se da de alta en Tesorería › Cajas y cuentas. Con `company`,
 * sólo las de esa empresa y las de las dos; con `types`, sólo las de esos tipos
 * (las que sirven para un medio de pago). `keep` deja en la lista una que ya
 * estaba elegida aunque después se haya inactivado.
 */
export function useCashAccounts(company?: string, keep?: string, types?: readonly string[] | null) {
  const [rows, setRows] = useState<CashAccountRow[]>([]);
  useEffect(() => { let alive = true; void loadCashAccounts().then(items => { if (alive) setRows(items); }); return () => { alive = false; }; }, []);
  return rows
    .filter(account => account._id === keep || (account.active !== false && (!company || cashAccountServes(account.company, company)) && (!types || types.includes(account.type))))
    .sort((a, b) => (a.code ?? Infinity) - (b.code ?? Infinity) || a.name.localeCompare(b.name, "es"))
    .map((account): Option => ({
      value: account._id, code: account.code ? String(account.code) : undefined,
      label: account.code ? `${account.code} · ${account.name}` : account.name,
      hint: `${cashAccountCompanyShort(account.company)} · ${cashAccountTypeLabels[account.type as keyof typeof cashAccountTypeLabels] || account.type}${account.currency && account.currency !== "ARS" ? ` · ${account.currency}` : ""}${account.active === false ? " · inactiva" : ""}`,
    }));
}

export function CashAccountSelect({ name, value, defaultValue, onChange, company, types, required, autoFocus, placeholder }: {
  name: string; value?: string; defaultValue?: string; onChange?: (value: string) => void; company?: string; types?: readonly string[] | null; required?: boolean; autoFocus?: boolean; placeholder?: string;
}) {
  const options = useCashAccounts(company, value ?? defaultValue, types);
  return <SearchSelect name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} required={required} autoFocus={autoFocus} placeholder={placeholder || "Código o nombre de la caja o cuenta…"} />;
}
