export type DashboardRange = "1m" | "3m" | "6m";
export type DashboardPeriod = DashboardRange | "custom";

export function parseDashboardRange(value: string | null): DashboardRange | null {
  if (value === null || value === "") return "3m";
  return value === "1m" || value === "3m" || value === "6m" ? value : null;
}

export function rangeMonths(range: DashboardRange) {
  return range === "1m" ? 1 : range === "3m" ? 3 : 6;
}

export function parseDashboardDate(value: string | null, endOfDay = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? parsed : null;
}

export function monthsBetween(from: Date, to: Date) {
  return (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth() + 1;
}

export function comparisonPercent(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function marginPercent(revenue: number, costs: number): number | null {
  if (revenue <= 0) return null;
  return Math.round(((revenue - costs) / revenue) * 1000) / 10;
}

export function monthKeys(start: Date, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth() + index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}
