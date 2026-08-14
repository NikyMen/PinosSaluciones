export type DashboardRange = "6m" | "12m";

export function parseDashboardRange(value: string | null): DashboardRange | null {
  if (value === null || value === "") return "6m";
  return value === "6m" || value === "12m" ? value : null;
}

export function rangeMonths(range: DashboardRange) {
  return range === "12m" ? 12 : 6;
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
