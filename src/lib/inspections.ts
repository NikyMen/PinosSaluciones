/**
 * Inspecciones de obra: plantillas por rubro y todas las cuentas del avance.
 *
 * Las plantillas salen de "PLANILLA DE INSPECCION DE OBRAS.xlsx" (cinco hojas:
 * albañilería, impermeabilización, espuma, pintura y trabajos en altura). Los
 * puntos de control se COPIAN dentro de cada inspección al crearla: si mañana
 * cambia la plantilla, las inspecciones viejas siguen mostrando lo que se
 * controló ese día.
 *
 * Este archivo no toca la base: lo usan la API al cerrar y la pantalla mientras
 * se carga, así las dos cuentan igual.
 */

export const INSPECTION_RUBROS = ["albanileria", "impermeabilizacion", "espuma_poliuretano", "pintura", "trabajos_altura"] as const;
export type InspectionRubro = (typeof INSPECTION_RUBROS)[number];

/** Se guarda en cada inspección para saber con qué versión de la plantilla se hizo. */
export const TEMPLATE_VERSION = 1;

export type Checkpoint = { key: string; label: string };

type Template = {
  label: string;
  quality: Checkpoint[];
  /** Sugerencias para "Etapa del día". Se puede escribir otra. */
  stages: string[];
  /** Pintura y altura agregan la distribución de colores. */
  colors: boolean;
};

export const inspectionTemplates: Record<InspectionRubro, Template> = {
  albanileria: {
    label: "Albañilería",
    colors: false,
    stages: [],
    quality: [
      { key: "plomo", label: "Plomo correcto: verificación de verticalidad con plomada / nivel láser en todos los paños ejecutados." },
      { key: "hiladas_refuerzo", label: "Hiladas de refuerzo." },
      { key: "nivel", label: "Nivel correcto: hiladas horizontales, sin desniveles visibles entre extremos del paño." },
      { key: "escuadra", label: "Escuadra correcta: ángulos a 90° en encuentros de muros verificados con escuadra." },
      { key: "traba", label: "Traba de mampostería: solape mínimo de 1/4 de ladrillo entre hiladas sucesivas." },
      { key: "juntas", label: "Espesor de juntas de mortero: entre 1,5 cm y 2 cm, uniforme en toda la hilada." },
      { key: "humectacion", label: "Humectación previa de mampuestos antes de su colocación." },
      { key: "hidrofugo", label: "Proporción y uso correcto de hidrófugo en cajones / mezclas según especificación técnica." },
    ],
  },
  impermeabilizacion: {
    label: "Impermeabilización",
    colors: false,
    stages: ["1ª mano", "2ª mano", "Refuerzos", "Preparación", "Terminación"],
    quality: [
      { key: "soporte_seco", label: "Soporte 100% seco: prueba de humedad realizada previo a la aplicación (sin humedad residual)." },
      { key: "pendientes", label: "Pendientes hacia embudos de desagüe entre 1,5% y 2%, verificadas con nivel." },
      { key: "mediacanas", label: "Ejecución de mediacañas en encuentros de paramentos verticales y horizontales." },
      { key: "solapes", label: "Solapes de membrana entre 8 y 10 cm, con sangría de asfalto visible en el solape." },
      { key: "refuerzos", label: "Refuerzos ejecutados en puntos singulares (desagües, quiebres, encuentros, pases de instalaciones)." },
      { key: "estanqueidad", label: "Prueba de estanqueidad (anegamiento 24-48 hs) realizada sin filtraciones detectadas." },
    ],
  },
  espuma_poliuretano: {
    label: "Espuma (poliuretano)",
    colors: false,
    stages: ["1ª mano", "2ª mano", "Refuerzos", "Preparación", "Terminación"],
    quality: [
      { key: "viento", label: "Velocidad de viento dentro del límite admisible para la aplicación (referencia: menor a 20 km/h)." },
      { key: "temperatura", label: "Temperatura de aplicación." },
      { key: "sustrato", label: "Sustrato libre de humedad y de polvo antes de la aplicación." },
      { key: "capas", label: "Aplicación realizada en capas sucesivas (no en una única pasada de espesor total)." },
      { key: "espesor", label: "Espesor verificado mediante punzonado aleatorio en distintos puntos del paño." },
      { key: "curado", label: "Estado de curado superficial correcto (sin blandeza ni pegajosidad remanente)." },
    ],
  },
  pintura: {
    label: "Pintura",
    colors: true,
    stages: ["1ª mano", "2ª mano", "Refuerzos", "Preparación", "Terminación"],
    quality: [
      { key: "enduido", label: "Enduido revisado con luz rasante: superficie sin marcas, ondulaciones ni imperfecciones visibles." },
      { key: "dilucion", label: "Dilución correcta de fijador / imprimación según ficha técnica del fabricante." },
      { key: "secado", label: "Tiempos de secado entre manos respetados estrictamente según especificación del fabricante." },
      { key: "chorreaduras", label: "Terminación sin chorreaduras en ningún paño inspeccionado." },
      { key: "cuarteos", label: "Terminación sin cuarteos ni fisuras en la película de pintura." },
    ],
  },
  trabajos_altura: {
    label: "Trabajos en altura",
    colors: true,
    stages: ["Preparación y reparación", "Fijador", "Sellador", "1ª mano", "2ª mano"],
    quality: [
      { key: "arnes", label: "Arnés de seguridad y amortiguador de caídas en buen estado y con certificación vigente." },
      { key: "lineas_vida", label: "Líneas de vida continuas, correctamente instaladas y sin empalmes irregulares." },
      { key: "anclajes", label: "Puntos de anclaje independientes de la estructura de trabajo (andamio / plataforma)." },
      { key: "andamios", label: "Andamios aplomados y correctamente arriostrados según normativa." },
      { key: "tablones", label: "Tablones de trabajo completos, atados entre sí y con rodapiés colocados." },
      { key: "clima", label: "Protocolo de suspensión de tareas por condiciones climáticas adversas aplicado correctamente." },
    ],
  },
};

/** Los mismos cuatro puntos en las cinco planillas. */
export const SAFETY_POINTS: Checkpoint[] = [
  { key: "epp", label: "EPP completo" },
  { key: "andamios", label: "Andamios / sillas OK" },
  { key: "lineas_vida", label: "Líneas de vida / anclajes OK" },
  { key: "zona", label: "Zona de trabajo segura y ordenada" },
];

export const WEATHER = ["seco", "humedo", "lluvia", "viento"] as const;
export const PERFORMANCE = ["bueno", "normal", "bajo"] as const;
export const PRODUCTION_CONSUMPTION = ["acorde", "consumo_alto", "produccion_baja"] as const;
export const CHECK_RESULTS = ["cumple", "no_cumple", "na"] as const;
export const MATERIAL_CONDITIONS = ["ok", "danado"] as const;
export const ORDER_STATUS = ["pedido_realizado", "pedido_pendiente"] as const;
export const DEVIATIONS = ["acorde", "consumo_alto", "consumo_bajo"] as const;
export const COLOR_SECTORS = ["Fachada", "Contrafachada", "Medianera izq.", "Medianera der."];

export type CheckResult = (typeof CHECK_RESULTS)[number];
export type Deviation = (typeof DEVIATIONS)[number];

export const optionLabels: Record<string, string> = {
  seco: "Seco", humedo: "Húmedo", lluvia: "Lluvia", viento: "Viento",
  bueno: "Bueno", normal: "Normal", bajo: "Bajo",
  acorde: "Acorde", consumo_alto: "Consumo alto", produccion_baja: "Producción baja", consumo_bajo: "Consumo bajo",
  cumple: "Cumple", no_cumple: "No cumple", na: "N/A",
  ok: "OK", danado: "Dañado",
  pedido_realizado: "Pedido realizado", pedido_pendiente: "Pedido pendiente",
  borrador: "Borrador", cerrada: "Cerrada",
};

export const deviationLabels: Record<Deviation, string> = {
  acorde: "Consumo acorde al avance",
  consumo_alto: "Consumo alto (va a faltar material)",
  consumo_bajo: "Consumo bajo (posible error de medición)",
};

export function rubroLabel(rubro?: string) {
  return inspectionTemplates[rubro as InspectionRubro]?.label || "Sin rubro";
}

export function isRubro(value: unknown): value is InspectionRubro {
  return INSPECTION_RUBROS.includes(value as InspectionRubro);
}

export type CheckItem = Checkpoint & { result: CheckResult | ""; notes: string };

/** Los puntos de control de un rubro, listos para copiar dentro de una inspección nueva. */
export function qualityChecklist(rubro: InspectionRubro): CheckItem[] {
  return inspectionTemplates[rubro].quality.map(point => ({ ...point, result: "", notes: "" }));
}

export function safetyChecklist(): CheckItem[] {
  return SAFETY_POINTS.map(point => ({ ...point, result: "", notes: "" }));
}

/* ─── Días ─────────────────────────────────────────────────────────────────── */

const TIMEZONE = "America/Argentina/Buenos_Aires";

/**
 * El día (aaaa-mm-dd) de una fecha, para comparar inspecciones, partes y
 * movimientos de stock. Lo que se carga con el selector de fecha llega como
 * medianoche UTC y se toma tal cual; lo que se guardó con la hora del momento
 * (un movimiento de stock sin fecha) se pasa a la hora de Argentina, si no un
 * ingreso de las 22 hs caería al día siguiente.
 */
export function dayKey(value: string | Date | undefined | null) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const utcMidnight = parsed.getUTCHours() === 0 && parsed.getUTCMinutes() === 0 && parsed.getUTCSeconds() === 0 && parsed.getUTCMilliseconds() === 0;
  if (utcMidnight) return parsed.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

/* ─── Avance ───────────────────────────────────────────────────────────────── */

/**
 * De dónde sale el avance de una obra: de las inspecciones, del número que se
 * cargaba a mano antes (obras viejas), o de ningún lado todavía (sin base).
 */
export type ProgressMode = "inspecciones" | "manual" | "sin_base";

/** Lo que hace falta de una obra para saber su avance (sirve la obra entera). */
type ProgressSource = { progressMode?: unknown; progress?: unknown; advances?: unknown; [key: string]: unknown };

/** Una obra vieja no tiene `progressMode`: si traía un avance cargado, es el manual de antes. */
export function progressModeOf(work: ProgressSource): ProgressMode {
  const mode = work.progressMode;
  if (mode === "inspecciones" || mode === "manual" || mode === "sin_base") return mode;
  return Number(work.progress) > 0 || (Array.isArray(work.advances) && work.advances.length > 0) ? "manual" : "sin_base";
}

/** El avance para mostrar: null cuando la obra no tiene base (no se muestra 0%). */
export function displayedProgress(work: ProgressSource): number | null {
  if (progressModeOf(work) === "sin_base") return null;
  return Math.min(100, Math.max(0, Number(work.progress) || 0));
}

export const progressModeHints: Record<ProgressMode, string> = {
  inspecciones: "Según las inspecciones cerradas",
  manual: "Avance cargado a mano antes de las inspecciones",
  sin_base: "Sin base de avance: cargá las cantidades previstas",
};

/**
 * La base del avance: lo que se contrató, en cantidades. Cada línea es un rubro
 * (o un ítem de un rubro) con su cantidad prevista y su importe, que es el peso
 * que tiene en el avance general.
 */
export type ProgressLine = {
  _id: string; rubro: InspectionRubro; label: string; unit: string; plannedQty: number; amountCents: number;
  /** Lo ejecutado antes de empezar con inspecciones: así una obra en marcha no arranca de cero. */
  initialQty?: number;
};

export type LineProgress = ProgressLine & { accumulatedQty: number; progressPct: number | null };

export type WorkProgress = {
  /** null = la obra no tiene cantidades previstas: no se inventa un porcentaje. */
  overall: number | null;
  lines: LineProgress[];
  byRubro: Partial<Record<InspectionRubro, number | null>>;
  /** Cómo se ponderó el general: por importe contratado o, si falta alguno, en partes iguales. */
  weighting: "importe" | "igual" | null;
};

export function round1(value: number) {
  return Math.round(value * 10) / 10;
}

/** Producción acumulada sobre la prevista, tope 100%. Sin cantidad prevista no hay porcentaje. */
export function lineProgress(plannedQty: number, accumulatedQty: number): number | null {
  const planned = Number(plannedQty) || 0;
  if (planned <= 0) return null;
  return round1(Math.min(100, Math.max(0, (Number(accumulatedQty) || 0) / planned * 100)));
}

/** Promedio ponderado. Con todos los importes cargados pesa la plata; si falta uno, todas las líneas pesan igual. */
function weighted(lines: LineProgress[]) {
  const counted = lines.filter(line => line.progressPct !== null);
  if (!counted.length) return { value: null, weighting: null } as const;
  const byAmount = counted.every(line => (Number(line.amountCents) || 0) > 0);
  const weight = (line: LineProgress) => byAmount ? Number(line.amountCents) : 1;
  const total = counted.reduce((sum, line) => sum + weight(line), 0);
  const value = counted.reduce((sum, line) => sum + (line.progressPct as number) * weight(line), 0) / total;
  return { value: round1(value), weighting: byAmount ? "importe" : "igual" } as const;
}

export function computeWorkProgress(lines: ProgressLine[], accumulatedByLine: Record<string, number>): WorkProgress {
  const detailed: LineProgress[] = lines.map(line => {
    const accumulatedQty = round1((Number(line.initialQty) || 0) + Number(accumulatedByLine[String(line._id)] || 0));
    return { ...line, accumulatedQty, progressPct: lineProgress(line.plannedQty, accumulatedQty) };
  });
  const byRubro: WorkProgress["byRubro"] = {};
  for (const rubro of INSPECTION_RUBROS) {
    const ofRubro = detailed.filter(line => line.rubro === rubro);
    if (ofRubro.length) byRubro[rubro] = weighted(ofRubro).value;
  }
  const overall = weighted(detailed);
  return { overall: overall.value, lines: detailed, byRubro, weighting: overall.weighting };
}

/**
 * Rubro probable de un ítem de la cotización, por su nombre. Es solo una
 * sugerencia al armar la base de avance: siempre se puede cambiar.
 */
export function guessRubro(name: string): InspectionRubro {
  const text = String(name || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (/altura|silleta|colgad|balancin/.test(text)) return "trabajos_altura";
  if (/espuma|poliuretano|poliurea/.test(text)) return "espuma_poliuretano";
  if (/impermeab|membrana|hidrofug|techad|azotea|cubierta/.test(text)) return "impermeabilizacion";
  if (/pint|latex|esmalte|enduido|fijador/.test(text)) return "pintura";
  return "albanileria";
}

/* ─── Materiales ───────────────────────────────────────────────────────────── */

/** Puntos de diferencia entre el % consumido y el % producido antes de avisar. */
export const DEVIATION_TOLERANCE = 10;

export type MaterialInput = { plannedQty?: number; stockStart?: number; receivedToday?: number; stockEnd?: number; previousConsumption?: number; receivedPrevious?: number };

export type MaterialControl = {
  consumptionToday: number;
  consumptionAccumulated: number;
  receivedAccumulated: number;
  remaining: number | null;
  consumptionPct: number | null;
  /** ¿Alcanza lo previsto? Proyecta el consumo a la obra terminada. */
  enough: boolean | null;
  deviation: Deviation | null;
};

/**
 * Control de materiales de la planilla. El consumo del día es lo que había, más
 * lo que entró, menos lo que quedó. El desvío compara cuánto material se gastó
 * contra cuánto se produjo: es una alerta, nunca mueve el avance.
 */
export function materialControl(input: MaterialInput, productionPct: number | null): MaterialControl {
  const planned = Number(input.plannedQty) || 0;
  const consumptionToday = round1((Number(input.stockStart) || 0) + (Number(input.receivedToday) || 0) - (Number(input.stockEnd) || 0));
  const consumptionAccumulated = round1((Number(input.previousConsumption) || 0) + consumptionToday);
  const receivedAccumulated = round1((Number(input.receivedPrevious) || 0) + (Number(input.receivedToday) || 0));
  if (planned <= 0) return { consumptionToday, consumptionAccumulated, receivedAccumulated, remaining: null, consumptionPct: null, enough: null, deviation: null };
  const consumptionPct = round1(consumptionAccumulated / planned * 100);
  const remaining = round1(planned - consumptionAccumulated);
  if (productionPct === null || productionPct <= 0) return { consumptionToday, consumptionAccumulated, receivedAccumulated, remaining, consumptionPct, enough: null, deviation: null };
  const projected = consumptionAccumulated / (productionPct / 100);
  const gap = consumptionPct - productionPct;
  const deviation: Deviation = gap > DEVIATION_TOLERANCE ? "consumo_alto" : gap < -DEVIATION_TOLERANCE ? "consumo_bajo" : "acorde";
  return { consumptionToday, consumptionAccumulated, receivedAccumulated, remaining, consumptionPct, enough: projected <= planned * 1.0001, deviation };
}

/* ─── Personal ─────────────────────────────────────────────────────────────── */

export type StaffSummary = {
  oficiales: number; medioOficiales: number; ayudantes: number; otros: number;
  hoursWorked: number;
  people: Array<{ name: string; category: string; hours: number }>;
};

/**
 * El personal del día sale de los partes diarios de la obra: la inspección no
 * vuelve a pedir lo que ya cargó quien lleva los horarios. La categoría viene de
 * la asignación a la obra.
 */
export function staffFromLabor(
  labor: Array<{ workerId?: unknown; person?: string; date?: string | Date; hours?: number }>,
  assigned: Array<{ workerId?: unknown; category?: string }>,
  day: string,
): StaffSummary {
  const categories = new Map(assigned.map(worker => [String(worker.workerId), String(worker.category || "")]));
  const byPerson = new Map<string, { name: string; category: string; hours: number }>();
  for (const entry of labor) {
    if (dayKey(entry.date) !== day) continue;
    const id = String(entry.workerId || entry.person || "");
    const current = byPerson.get(id) || { name: String(entry.person || "Sin nombre"), category: categories.get(String(entry.workerId)) || "", hours: 0 };
    current.hours = round1(current.hours + (Number(entry.hours) || 0));
    byPerson.set(id, current);
  }
  const people = [...byPerson.values()];
  const count = (category: string) => people.filter(person => person.category === category).length;
  const oficiales = count("oficial");
  const medioOficiales = count("medio_oficial");
  const ayudantes = count("ayudante");
  return {
    oficiales, medioOficiales, ayudantes,
    otros: people.length - oficiales - medioOficiales - ayudantes,
    hoursWorked: round1(people.reduce((sum, person) => sum + person.hours, 0)),
    people,
  };
}

/* ─── Cierre ───────────────────────────────────────────────────────────────── */

export type InspectionDraft = {
  rubro: InspectionRubro;
  managerName?: string;
  weather?: string;
  performance?: string;
  lowPerformanceReason?: string;
  production?: Array<{ lineId?: string; label?: string; unit?: string; plannedQty?: number; todayQty?: number | null; accumulatedQty?: number }>;
  quality?: Array<{ label: string; result?: string }>;
  safety?: Array<{ label: string; result?: string }>;
  incidents?: string;
  mainMaterial?: { name?: string; unit?: string } & MaterialInput;
  shortages?: Array<{ material?: string; quantity?: number; unit?: string }>;
  shortageNeededBy?: string | Date | null;
  shortageOrderStatus?: string;
};

/** Lo que falta o no cierra para poder cerrar la inspección. Vacío = se puede cerrar. */
export function closeProblems(draft: InspectionDraft): string[] {
  const problems: string[] = [];
  if (!String(draft.managerName || "").trim()) problems.push("Falta el encargado.");
  if (!draft.weather) problems.push("Falta el clima.");
  for (const row of draft.production || []) {
    const today = row.todayQty;
    if (today === null || today === undefined || Number.isNaN(Number(today))) problems.push(`Falta la producción de hoy de ${row.label || "la línea"} (poné 0 si no hubo).`);
    else if (Number(today) < 0) problems.push(`La producción de hoy de ${row.label || "la línea"} no puede ser negativa.`);
  }
  if (draft.performance === "bajo" && !String(draft.lowPerformanceReason || "").trim()) problems.push("Con rendimiento bajo hay que explicar el motivo.");
  const pendingQuality = (draft.quality || []).filter(point => !point.result).length;
  if (pendingQuality) problems.push(`Quedan ${pendingQuality} puntos de calidad sin resultado.`);
  const pendingSafety = (draft.safety || []).filter(point => !point.result).length;
  if (pendingSafety) problems.push(`Quedan ${pendingSafety} puntos de seguridad sin resultado.`);
  const material = draft.mainMaterial;
  if (material?.name?.trim()) {
    const values = [material.plannedQty, material.stockStart, material.receivedToday, material.stockEnd];
    if (values.some(value => Number(value) < 0)) problems.push("Las cantidades de material no pueden ser negativas.");
    else if ((Number(material.stockStart) || 0) + (Number(material.receivedToday) || 0) - (Number(material.stockEnd) || 0) < 0) {
      problems.push(`El stock al final del día de ${material.name} es mayor que lo que había más lo que entró: revisá las cantidades.`);
    }
  }
  const shortages = (draft.shortages || []).filter(row => String(row.material || "").trim());
  if (shortages.some(row => !(Number(row.quantity) > 0))) problems.push("Cada faltante necesita una cantidad mayor a cero.");
  if (shortages.length && !draft.shortageNeededBy) problems.push("Con faltantes cargados hay que indicar para cuándo se necesitan.");
  return problems;
}

export type AlertKind = "calidad" | "seguridad" | "materiales" | "rendimiento" | "produccion";
export type InspectionAlert = { kind: AlertKind; message: string };

/** Las alertas que deja una inspección cerrada: incumplimientos, riesgos y material. */
export function inspectionAlerts(draft: InspectionDraft, material: MaterialControl | null): InspectionAlert[] {
  const alerts: InspectionAlert[] = [];
  for (const point of draft.quality || []) {
    if (point.result === "no_cumple") alerts.push({ kind: "calidad", message: `No cumple: ${point.label}` });
  }
  for (const point of draft.safety || []) {
    if (point.result === "no_cumple") alerts.push({ kind: "seguridad", message: `No cumple: ${point.label}` });
  }
  if (String(draft.incidents || "").trim()) alerts.push({ kind: "seguridad", message: `Incidente o riesgo: ${String(draft.incidents).trim()}` });
  if (draft.performance === "bajo") alerts.push({ kind: "rendimiento", message: `Rendimiento bajo: ${String(draft.lowPerformanceReason || "sin motivo").trim()}` });
  for (const row of draft.production || []) {
    if ((Number(row.plannedQty) || 0) > 0 && (Number(row.accumulatedQty) || 0) > Number(row.plannedQty)) {
      alerts.push({ kind: "produccion", message: `${row.label}: la producción acumulada (${row.accumulatedQty} ${row.unit || ""}) supera la prevista (${row.plannedQty}).` });
    }
  }
  const shortages = (draft.shortages || []).filter(row => String(row.material || "").trim());
  if (shortages.length) {
    const list = shortages.map(row => `${row.material} (${row.quantity || 0}${row.unit ? ` ${row.unit}` : ""})`).join(", ");
    alerts.push({ kind: "materiales", message: `Faltantes: ${list}${draft.shortageOrderStatus === "pedido_realizado" ? " — pedido realizado" : " — pedido pendiente"}.` });
  }
  if (material && draft.mainMaterial?.name) {
    if (material.deviation === "consumo_alto") alerts.push({ kind: "materiales", message: `${draft.mainMaterial.name}: consumo alto para el avance (${material.consumptionPct}% del material).` });
    if (material.deviation === "consumo_bajo") alerts.push({ kind: "materiales", message: `${draft.mainMaterial.name}: consumo bajo para el avance, revisar la medición.` });
    if (material.enough === false) alerts.push({ kind: "materiales", message: `${draft.mainMaterial.name}: al ritmo actual no alcanza lo previsto.` });
  }
  return alerts;
}
