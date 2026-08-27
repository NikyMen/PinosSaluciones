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

// Las fechas de calendario (vencimientos, inicios de obra) se guardan a medianoche UTC.
// Formatearlas en horario argentino las corria un dia para atras: 15/09 se veia 14/09.
export function date(value?: string | Date) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

// Los instantes reales (auditoria, actividad de obra) si van en hora argentina.
export function dateTime(value?: string | Date) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value));
}

export function titleCase(value?: string) {
  return value ? value.replaceAll("_", " ").replace(/^./, character => character.toUpperCase()) : "—";
}

/* ── Fechas en formato argentino (dd/mm/aaaa) ─────────────────────────────── */

/** ISO (aaaa-mm-dd) → dd/mm/aaaa. Devuelve "" si no hay valor válido. */
export function isoToDisplayDate(iso?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

/** dd/mm/aaaa → ISO (aaaa-mm-dd). Devuelve "" si la fecha no existe en el calendario. */
export function displayDateToIso(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return "";
  const [, day, month, year] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (parsed.getFullYear() !== Number(year) || parsed.getMonth() !== Number(month) - 1 || parsed.getDate() !== Number(day)) return "";
  return `${year}-${month}-${day}`;
}

/** Va poniendo las barras sola mientras se tipea: "1512" → "15/12". */
export function maskDate(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Fecha de hoy en ISO, tomada en horario argentino (no en UTC). */
export function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

/** ISO de hoy + N días, para los atajos de vencimiento (7 / 14 / 30). */
export function isoPlusDays(days: number) {
  const [year, month, day] = todayIso().split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1, day + days));
  return target.toISOString().slice(0, 10);
}

/* ── Importes con separador de miles mientras se tipea ─────────────────────── */

/** "1234567,5" → "1.234.567,5". Conserva la coma abierta para poder seguir tipeando. */
export function maskAmount(value: string) {
  const cleaned = value.replace(/[^\d,]/g, "");
  const [whole, ...rest] = cleaned.split(",");
  const decimals = rest.join("").slice(0, 2);
  const grouped = whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (!cleaned.includes(",")) return grouped;
  return `${grouped || "0"},${decimals}`;
}

/** "1.234.567,50" → 1234567.5 */
export function parseAmount(value: string) {
  const normalized = String(value || "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Número → "1.234.567,50" para precargar el input al editar. */
export function amountToInput(amount: number) {
  if (!amount) return "";
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}
