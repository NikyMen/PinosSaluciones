"use client";

import { useEffect, useState } from "react";
import type { Option } from "@/components/fields";
import { accountCodeLabels, accountDirection, type AccountCode } from "@/lib/account-catalog";

type AccountRow = { _id: string; code: AccountCode; name: string; active?: boolean };

// El plan de cuentas cambia poco: se pide una vez por pantalla y lo comparten todos los selects.
let cache: Promise<AccountRow[]> | null = null;

function loadAccounts() {
  cache ??= fetch("/api/records/accounts?limit=300")
    .then(response => response.ok ? response.json() as Promise<{ items?: AccountRow[] }> : { items: [] })
    .then(result => result.items || [])
    .catch(() => { cache = null; return []; });
  return cache;
}

/** Las cuentas activas del plan para elegir en un select. Con `direction`, solo las de ingreso (CI) o las de egreso. */
export function useLedgerAccounts(direction?: "ingreso" | "egreso") {
  const [rows, setRows] = useState<AccountRow[]>([]);
  useEffect(() => { let alive = true; void loadAccounts().then(items => { if (alive) setRows(items); }); return () => { alive = false; }; }, []);
  return rows
    .filter(account => account.active !== false && (!direction || accountDirection(account.code) === direction))
    .map((account): Option => ({ value: account._id, label: account.name, hint: accountCodeLabels[account.code] }));
}
