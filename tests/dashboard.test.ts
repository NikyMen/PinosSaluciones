import { describe, expect, it } from "vitest";
import { comparisonPercent, marginPercent, monthKeys, monthsBetween, parseDashboardDate, parseDashboardRange, rangeMonths } from "../src/lib/dashboard";

describe("tablero gerencial", () => {
  it("acepta solamente los períodos soportados", () => {
    expect(parseDashboardRange(null)).toBe("3m");
    expect(parseDashboardRange("1m")).toBe("1m");
    expect(parseDashboardRange("3m")).toBe("3m");
    expect(parseDashboardRange("6m")).toBe("6m");
    expect(parseDashboardRange("12m")).toBeNull();
    expect(parseDashboardRange("24m")).toBeNull();
    expect(rangeMonths("1m")).toBe(1);
    expect(rangeMonths("6m")).toBe(6);
  });

  it("calcula comparaciones sin producir infinitos", () => {
    expect(comparisonPercent(150, 100)).toBe(50);
    expect(comparisonPercent(50, 100)).toBe(-50);
    expect(comparisonPercent(0, 0)).toBe(0);
    expect(comparisonPercent(100, 0)).toBeNull();
  });

  it("calcula margen y períodos mensuales", () => {
    expect(marginPercent(1_000, 750)).toBe(25);
    expect(marginPercent(0, 100)).toBeNull();
    expect(monthKeys(new Date(2026, 10, 1), 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });

  it("valida fechas personalizadas y calcula meses incluidos", () => {
    const from = parseDashboardDate("2026-01-15");
    const to = parseDashboardDate("2026-03-10", true);
    expect(from?.getDate()).toBe(15);
    expect(to?.getHours()).toBe(23);
    expect(parseDashboardDate("2026-02-30")).toBeNull();
    expect(monthsBetween(from!, to!)).toBe(3);
  });
});
