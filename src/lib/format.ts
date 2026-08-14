export function money(cents = 0) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(cents / 100);
}

export function compactMoney(cents = 0) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

export function date(value?: string | Date) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(value));
}

export function titleCase(value?: string) {
  return value ? value.replaceAll("_", " ").replace(/^./, character => character.toUpperCase()) : "—";
}
