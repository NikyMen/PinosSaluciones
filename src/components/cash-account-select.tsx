"use client";

import { useEffect, useState } from "react";
import { SearchSelect, type Option } from "@/components/fields";
import { companyOf, type CompanyKey } from "@/lib/companies";

export type CashAccountRow = { _id: string; name: string; company: CompanyKey; type: string; bank?: string; currency?: string; active?: boolean };

export const cashAccountTypeLabels: Record<string, string> = { caja: "Caja", cuenta_corriente: "Cuenta corriente", caja_ahorro: "Caja de ahorro", cuenta_dolares: "Cuenta en dólares", otra: "Otra" };

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
 * Las cajas y cuentas bancarias activas del maestro, para elegir. No se crea
 * una escribiendo un nombre nuevo: se da de alta en Tesorería › Cajas y cuentas.
 * Con `company`, primero las de esa empresa. `keep` deja en la lista una que ya
 * estaba elegida aunque después se haya inactivado.
 */
export function useCashAccounts(company?: string, keep?: string) {
  const [rows, setRows] = useState<CashAccountRow[]>([]);
  useEffect(() => { let alive = true; void loadCashAccounts().then(items => { if (alive) setRows(items); }); return () => { alive = false; }; }, []);
  return rows
    .filter(account => account.active !== false || account._id === keep)
    .sort((a, b) => Number(company && b.company === company) - Number(company && a.company === company) || a.name.localeCompare(b.name, "es"))
    .map((account): Option => ({ value: account._id, label: account.name, hint: `${companyOf(account.company).short} · ${cashAccountTypeLabels[account.type] || account.type}${account.currency === "USD" ? " · USD" : ""}${account.active === false ? " · inactiva" : ""}` }));
}

export function CashAccountSelect({ name, value, defaultValue, onChange, company, required, autoFocus, placeholder }: {
  name: string; value?: string; defaultValue?: string; onChange?: (value: string) => void; company?: string; required?: boolean; autoFocus?: boolean; placeholder?: string;
}) {
  const options = useCashAccounts(company, value ?? defaultValue);
  return <SearchSelect name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} required={required} autoFocus={autoFocus} placeholder={placeholder || "Elegí la caja o cuenta…"} />;
}
