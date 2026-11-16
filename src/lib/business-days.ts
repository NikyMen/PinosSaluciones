const DAY_MS = 86_400_000;

function utcDay(value: string | Date) {
  if (value instanceof Date && !Number.isFinite(value.getTime())) return NaN;
  const iso = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  return Date.parse(iso + "T00:00:00.000Z");
}

function dayKey(milliseconds: number) {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function weekday(milliseconds: number) {
  const day = new Date(milliseconds).getUTCDay();
  return day > 0 && day < 6;
}

export function businessDaysBetween(start: string | Date, end: string | Date, holidays: ReadonlySet<string>) {
  const from = utcDay(start);
  const to = utcDay(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  const days = (to - from) / DAY_MS + 1;
  let count = Math.floor(days / 7) * 5;
  for (let day = 0; day < days % 7; day++) if (weekday(from + day * DAY_MS)) count++;
  for (const holiday of holidays) {
    const date = utcDay(holiday);
    if (date >= from && date <= to && weekday(date)) count--;
  }
  return count;
}

function businessBoundary(anchor: string | Date, duration: number, holidays: ReadonlySet<string>, step: 1 | -1) {
  let cursor = utcDay(anchor);
  if (!Number.isFinite(cursor) || !Number.isSafeInteger(duration) || duration < 1 || duration > 3650) return "";
  let remaining = duration;
  for (;;) {
    if (weekday(cursor) && !holidays.has(dayKey(cursor))) remaining--;
    if (!remaining) return dayKey(cursor);
    cursor += DAY_MS * step;
  }
}

/** El día de inicio se cuenta si es hábil; el fin es el último día trabajado. */
export function workEndForDays(start: string | Date, duration: number, holidays: ReadonlySet<string>) {
  return businessBoundary(start, duration, holidays, 1);
}

export function workStartForDays(end: string | Date, duration: number, holidays: ReadonlySet<string>) {
  return businessBoundary(end, duration, holidays, -1);
}
