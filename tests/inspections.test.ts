import { describe, expect, it } from "vitest";
import {
  INSPECTION_RUBROS, closeProblems, computeWorkProgress, dayKey, displayedProgress, guessRubro, inspectionAlerts, inspectionTemplates,
  lineProgress, materialControl, progressModeOf, qualityChecklist, safetyChecklist, staffFromLabor, type InspectionDraft, type ProgressLine,
} from "../src/lib/inspections";
import { inspectionCreatePayload, inspectionPayload, progressBasePayload, schemas } from "../src/lib/schemas";
import { entityConfig } from "../src/lib/entity-config";

const line = (id: string, rubro: ProgressLine["rubro"], plannedQty: number, amountCents: number, initialQty = 0): ProgressLine =>
  ({ _id: id, rubro, label: id, unit: "m2", plannedQty, amountCents, initialQty });

describe("plantillas de inspección (planilla de Excel)", () => {
  it("tiene las cinco planillas", () => {
    expect(INSPECTION_RUBROS).toEqual(["albanileria", "impermeabilizacion", "espuma_poliuretano", "pintura", "trabajos_altura"]);
  });
  it("copia los puntos de calidad del rubro, sin resultado", () => {
    expect(qualityChecklist("albanileria")).toHaveLength(8);
    expect(qualityChecklist("pintura")).toHaveLength(5);
    expect(qualityChecklist("trabajos_altura").every(point => point.result === "" && point.notes === "")).toBe(true);
  });
  it("los cuatro puntos de seguridad son los mismos en todos los rubros", () => {
    expect(safetyChecklist().map(point => point.key)).toEqual(["epp", "andamios", "lineas_vida", "zona"]);
  });
  it("solo pintura y altura llevan distribución de colores", () => {
    expect(INSPECTION_RUBROS.filter(rubro => inspectionTemplates[rubro].colors)).toEqual(["pintura", "trabajos_altura"]);
  });
  it("la copia no comparte referencias con la plantilla", () => {
    const copy = qualityChecklist("pintura");
    copy[0].label = "cambiado";
    expect(inspectionTemplates.pintura.quality[0].label).not.toBe("cambiado");
  });
});

describe("avance físico", () => {
  it("por línea: acumulada sobre prevista, con tope en 100%", () => {
    expect(lineProgress(200, 50)).toBe(25);
    expect(lineProgress(200, 260)).toBe(100);
  });
  it("sin cantidad prevista no inventa un porcentaje", () => {
    expect(lineProgress(0, 50)).toBeNull();
    expect(computeWorkProgress([], {}).overall).toBeNull();
    expect(computeWorkProgress([line("a", "pintura", 0, 1000)], { a: 10 }).overall).toBeNull();
  });
  it("el general se pondera por importe contratado", () => {
    // Pintura 50% con $300.000 y albañilería 100% con $100.000: 62,5%.
    const result = computeWorkProgress([line("p", "pintura", 100, 30_000_000), line("a", "albanileria", 10, 10_000_000)], { p: 50, a: 10 });
    expect(result.overall).toBe(62.5);
    expect(result.weighting).toBe("importe");
    expect(result.byRubro).toEqual({ pintura: 50, albanileria: 100 });
  });
  it("si falta algún importe, todas las líneas pesan igual", () => {
    const result = computeWorkProgress([line("p", "pintura", 100, 30_000_000), line("a", "albanileria", 10, 0)], { p: 50, a: 10 });
    expect(result.overall).toBe(75);
    expect(result.weighting).toBe("igual");
  });
  it("suma lo ya ejecutado antes de las inspecciones (migración del avance manual)", () => {
    const result = computeWorkProgress([line("p", "pintura", 100, 1, 40)], { p: 10 });
    expect(result.lines[0].accumulatedQty).toBe(50);
    expect(result.overall).toBe(50);
  });
  it("una línea sin cantidad prevista no entra en el promedio", () => {
    expect(computeWorkProgress([line("p", "pintura", 100, 1), line("x", "pintura", 0, 1)], { p: 30 }).overall).toBe(30);
  });
});

describe("de dónde sale el avance", () => {
  it("una obra vieja con avance cargado es manual; sin nada, sin base", () => {
    expect(progressModeOf({ progress: 40 })).toBe("manual");
    expect(progressModeOf({ progress: 0, advances: [{ percentage: 10 }] })).toBe("manual");
    expect(progressModeOf({ progress: 0 })).toBe("sin_base");
    expect(progressModeOf({ progressMode: "inspecciones", progress: 12 })).toBe("inspecciones");
  });
  it("sin base no se muestra 0%", () => {
    expect(displayedProgress({ progressMode: "sin_base", progress: 0 })).toBeNull();
    expect(displayedProgress({ progressMode: "inspecciones", progress: 37.5 })).toBe(37.5);
  });
});

describe("control de materiales", () => {
  it("consumo del día = stock inicial + recibido − stock final", () => {
    const control = materialControl({ plannedQty: 100, stockStart: 10, receivedToday: 20, stockEnd: 12, previousConsumption: 30, receivedPrevious: 40 }, 50);
    expect(control.consumptionToday).toBe(18);
    expect(control.consumptionAccumulated).toBe(48);
    expect(control.receivedAccumulated).toBe(60);
    expect(control.remaining).toBe(52);
    expect(control.deviation).toBe("acorde");
    expect(control.enough).toBe(true);
  });
  it("avisa consumo alto cuando se gastó bastante más material que lo producido", () => {
    const control = materialControl({ plannedQty: 100, stockStart: 0, receivedToday: 70, stockEnd: 0 }, 40);
    expect(control.deviation).toBe("consumo_alto");
    expect(control.enough).toBe(false);
  });
  it("avisa consumo bajo (posible error de medición)", () => {
    expect(materialControl({ plannedQty: 100, stockStart: 10, receivedToday: 0, stockEnd: 0 }, 60).deviation).toBe("consumo_bajo");
  });
  it("sin avance medido no calcula desvío: es un indicador, no inventa", () => {
    const control = materialControl({ plannedQty: 100, stockStart: 10, receivedToday: 0, stockEnd: 5 }, null);
    expect(control.deviation).toBeNull();
    expect(control.enough).toBeNull();
  });
});

describe("personal desde los partes diarios", () => {
  it("cuenta por categoría y suma las horas del día", () => {
    const labor = [
      { workerId: "w1", person: "Pérez, Juan", date: "2026-09-18T00:00:00.000Z", hours: 8 },
      { workerId: "w2", person: "Gómez, Ana", date: "2026-09-18T00:00:00.000Z", hours: 4 },
      { workerId: "w2", person: "Gómez, Ana", date: "2026-09-18T00:00:00.000Z", hours: 4 },
      { workerId: "w3", person: "Ruiz, Luis", date: "2026-09-17T00:00:00.000Z", hours: 8 },
    ];
    const staff = staffFromLabor(labor, [{ workerId: "w1", category: "oficial" }, { workerId: "w2", category: "ayudante" }, { workerId: "w3", category: "oficial" }], "2026-09-18");
    expect(staff.oficiales).toBe(1);
    expect(staff.ayudantes).toBe(1);
    expect(staff.hoursWorked).toBe(16);
    expect(staff.people).toHaveLength(2);
  });
  it("el día de un movimiento con hora se toma en horario de Argentina", () => {
    expect(dayKey("2026-09-18T00:00:00.000Z")).toBe("2026-09-18");
    // 22:30 del 17 en Argentina = 01:30 UTC del 18.
    expect(dayKey("2026-09-18T01:30:00.000Z")).toBe("2026-09-17");
  });
});

const base: InspectionDraft = {
  rubro: "pintura", managerName: "Encargado", weather: "seco", performance: "normal",
  production: [{ lineId: "l1", label: "Fachada", unit: "m2", plannedQty: 100, todayQty: 10, accumulatedQty: 60 }],
  quality: qualityChecklist("pintura").map(point => ({ ...point, result: "cumple" })),
  safety: safetyChecklist().map(point => ({ ...point, result: "cumple" })),
};

describe("cierre de la inspección", () => {
  it("con todo cargado se puede cerrar", () => {
    expect(closeProblems(base)).toEqual([]);
  });
  it("pide encargado, clima, producción de hoy y todos los puntos controlados", () => {
    const problems = closeProblems({ ...base, managerName: " ", weather: "", production: [{ label: "Fachada", todayQty: undefined }], quality: [{ label: "x", result: "" }] });
    expect(problems.join(" ")).toMatch(/encargado/);
    expect(problems.join(" ")).toMatch(/clima/);
    expect(problems.join(" ")).toMatch(/producción de hoy/);
    expect(problems.join(" ")).toMatch(/calidad sin resultado/);
  });
  it("con rendimiento bajo exige el motivo", () => {
    expect(closeProblems({ ...base, performance: "bajo" }).join(" ")).toMatch(/motivo/);
    expect(closeProblems({ ...base, performance: "bajo", lowPerformanceReason: "Lluvia" })).toEqual([]);
  });
  it("no acepta un stock final mayor a lo que había más lo recibido", () => {
    expect(closeProblems({ ...base, mainMaterial: { name: "Látex", stockStart: 5, receivedToday: 0, stockEnd: 8 } }).join(" ")).toMatch(/stock al final/);
  });
  it("los faltantes necesitan cantidad y fecha", () => {
    const problems = closeProblems({ ...base, shortages: [{ material: "Rodillos", quantity: 0 }] }).join(" ");
    expect(problems).toMatch(/cantidad mayor a cero/);
    expect(problems).toMatch(/para cuándo/);
  });
  it("genera alertas por incumplimientos, riesgos, faltantes y desvíos", () => {
    const alerts = inspectionAlerts({
      ...base,
      quality: [{ label: "Sin chorreaduras", result: "no_cumple" }],
      safety: [{ label: "EPP completo", result: "no_cumple" }],
      incidents: "Tablón suelto",
      shortages: [{ material: "Látex", quantity: 4, unit: "baldes" }],
      mainMaterial: { name: "Látex" },
    }, { consumptionToday: 1, consumptionAccumulated: 80, receivedAccumulated: 80, remaining: 20, consumptionPct: 80, enough: false, deviation: "consumo_alto" });
    expect(alerts.map(alert => alert.kind)).toEqual(["calidad", "seguridad", "seguridad", "materiales", "materiales", "materiales"]);
  });
  it("avisa si la producción acumulada supera la prevista", () => {
    expect(inspectionAlerts({ ...base, production: [{ label: "Fachada", unit: "m2", plannedQty: 100, accumulatedQty: 120 }] }, null)[0].kind).toBe("produccion");
  });
});

describe("validaciones de la API", () => {
  it("el formulario de obra ya no escribe el avance ni los avances manuales", () => {
    const parsed = schemas.works.partial().safeParse({ progress: 90, advances: [{ percentage: 90 }], name: "Obra" });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("progress");
    expect(parsed.data).not.toHaveProperty("advances");
    expect(entityConfig.works.fields.find(field => field.key === "progress")?.readOnly).toBe(true);
  });
  it("el alta de inspección pide día y rubro válidos", () => {
    expect(inspectionCreatePayload.safeParse({ date: "2026-09-18", rubro: "pintura" }).success).toBe(true);
    expect(inspectionCreatePayload.safeParse({ date: "18/09/2026", rubro: "pintura" }).success).toBe(false);
    expect(inspectionCreatePayload.safeParse({ date: "2026-09-18", rubro: "herreria" }).success).toBe(false);
  });
  it("una cantidad vacía es “no cargada”, no cero, y no acepta negativos", () => {
    const parsed = inspectionPayload.safeParse({ production: [{ lineId: "", todayQty: "" }] });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.production?.[0].todayQty).toBeUndefined();
    expect(inspectionPayload.safeParse({ production: [{ todayQty: -3 }] }).success).toBe(false);
  });
  it("la base de avance no acepta cantidades negativas", () => {
    expect(progressBasePayload.safeParse({ lines: [{ rubro: "pintura", label: "Fachada", plannedQty: 100, amountCents: 1000 }] }).success).toBe(true);
    expect(progressBasePayload.safeParse({ lines: [{ rubro: "pintura", label: "Fachada", plannedQty: -1 }] }).success).toBe(false);
  });
});

describe("sugerencia de rubro para los ítems de la cotización", () => {
  it("reconoce los rubros por el nombre del ítem", () => {
    expect(guessRubro("Pintura látex exterior")).toBe("pintura");
    expect(guessRubro("Impermeabilización con membrana")).toBe("impermeabilizacion");
    expect(guessRubro("Espuma de poliuretano proyectada")).toBe("espuma_poliuretano");
    expect(guessRubro("Trabajos en altura con silleta")).toBe("trabajos_altura");
    expect(guessRubro("Revoque grueso")).toBe("albanileria");
  });
});
