import type { Option } from "@/components/fields";

/*
 * Proveedores y clientes en los selectores (anexo de Tesorería v5.1): se buscan
 * por código, razón social, nombre de fantasía o CUIT, y se eligen escribiendo
 * el código y Enter, como en TANGO. El código lo pone el sistema.
 */

type Party = { _id: string; code?: unknown; name?: unknown; tradeName?: unknown; cuit?: unknown; email?: unknown };

export function partyOption(party: Party): Option {
  const code = party.code ? String(party.code) : undefined;
  const name = String(party.name || "");
  return {
    value: party._id, code,
    label: code ? `${code} · ${name}` : name,
    hint: [party.tradeName && party.tradeName !== party.name ? String(party.tradeName) : "", party.cuit ? `CUIT ${String(party.cuit)}` : String(party.email || "")].filter(Boolean).join(" · ") || undefined,
  };
}
