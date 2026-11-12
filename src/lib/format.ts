/**
 * Todo importe va con sus centavos, en compras y en ventas: mostrarlo redondeado
 * escondía diferencias de centavos (una OP de $461.650 que no cerraba contra
 * medios por $461.649,96 y en pantalla se veían iguales).
 */
export function money(cents = 0) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((Number(cents) || 0) / 100);
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

/** Cantidades con coma decimal, como se escriben aca: 1,5 jornadas · 0,4 lts/m2. */
export function qty(value = 0, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits }).format(Number(value) || 0);
}

/** Importe con centavos: para precios unitarios, donde money() redondea demasiado. */
export function preciseMoney(cents = 0) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((Number(cents) || 0) / 100);
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

/**
 * El punto que se acaba de tipear (el del teclado numérico) es la coma decimal:
 * compara con lo que había antes y, si lo único nuevo es un ".", lo cambia por ",".
 * Los puntos de los miles los pone la máscara, así que no se confunden.
 */
export function decimalPointToComma(previous: string, next: string) {
  if (next.length !== previous.length + 1) return next;
  let index = 0;
  while (index < previous.length && previous[index] === next[index]) index++;
  if (next[index] !== "." || next.slice(index + 1) !== previous.slice(index)) return next;
  // Ya hay una coma: el segundo separador decimal no hace nada.
  if (previous.includes(",")) return previous;
  return `${next.slice(0, index).replace(/\./g, "")},${next.slice(index + 1).replace(/\./g, "")}`;
}

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
