import { describe, expect, it } from "vitest";
import { businessDaysBetween, workEndForDays, workStartForDays } from "../src/lib/business-days";
import { coordinatesFromMaps, directionsHref, safeGoogleMapsUrl } from "../src/lib/project-location";

describe("planificación de obras", () => {
  const holidays = new Set(["2026-11-09", "2026-11-23", "2026-12-08"]);

  it("calcula 25 días desde un miércoles, sin fines de semana ni feriados", () => {
    expect(workEndForDays("2026-11-04", 25, holidays)).toBe("2026-12-11");
    expect(workStartForDays("2026-12-11", 25, holidays)).toBe("2026-11-04");
    expect(businessDaysBetween("2026-11-04", "2026-12-11", holidays)).toBe(25);
    expect(businessDaysBetween("2026-11-07", "2026-11-09", holidays)).toBe(0);
    expect(workEndForDays("2026-11-07", 1, holidays)).toBe("2026-11-10");
  });

  it("lee coordenadas del enlace de Maps y acepta una dirección", () => {
    expect(coordinatesFromMaps("https://www.google.com/maps/@-27.47,-58.83,16z")).toEqual({ latitude: -27.47, longitude: -58.83 });
    expect(coordinatesFromMaps("https://www.google.com/maps/place/example/@1,1,16z/data=!3d-27.47!4d-58.83")).toEqual({ latitude: -27.47, longitude: -58.83 });
    expect(safeGoogleMapsUrl("https://maps.app.goo.gl.example.com/")).toBe("");
    expect(directionsHref({ address: "Corrientes, Argentina" })).toContain("query=Corrientes%2C%20Argentina");
  });
});
