import { z } from "zod";
import type { Entity } from "./constants";
import { CHECK_RESULTS, INSPECTION_RUBROS, MATERIAL_CONDITIONS, ORDER_STATUS, PERFORMANCE, PRODUCTION_CONSUMPTION, WEATHER } from "./inspections";

const id = z.string().regex(/^[a-f\d]{24}$/i, "ID inválido");
const optionalId = z.union([id, z.literal("")]).optional().transform(v => v || undefined);
const text = z.string().trim().min(1);
const optionalText = z.string().trim().optional().default("");
const cents = z.coerce.number().int().min(0);
const date = z.coerce.date();
const optionalDate = z.union([z.coerce.date(), z.literal("")]).optional().transform(v => v || undefined);
// El CUIT llega tipeado a mano: se acepta con o sin guiones y se guarda normalizado.
const cuit = z.string().trim().transform(v => v.replace(/\D/g, "")).refine(v => v.length === 11, "El CUIT tiene que tener 11 dígitos").transform(v => `${v.slice(0, 2)}-${v.slice(2, 10)}-${v.slice(10)}`);
// La lista de teléfonos viaja como JSON desde el formulario.
const phoneList = z.preprocess(value => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim().startsWith("[")) { try { return JSON.parse(value); } catch { return []; } }
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}, z.array(z.string().trim().min(1)).default([]));

export const schemas: Record<Entity, z.ZodObject<z.ZodRawShape>> = {
  clients: z.object({ name: text, cuit: cuit, contactName: optionalText, email: optionalText, phones: phoneList, address: optionalText, notes: optionalText, active: z.boolean().optional().default(true) }),
  quotes: z.object({ number: z.string().trim().optional().transform(v => v || undefined), clientId: id, title: text, description: optionalText, version: z.coerce.number().int().min(1).default(1), amountCents: cents, estimatedCostCents: cents.default(0), status: z.enum(["borrador", "enviada", "seguimiento", "aprobada", "rechazada", "vencida", "convertida"]), ownerId: optionalId, validUntil: optionalDate, workId: optionalId, attachment: optionalText }),
  works: z.object({ assignedWorkers: z.array(z.any()).optional(), code: text, name: text, clientId: id, quoteId: optionalId, managerId: optionalId, status: z.enum(["planificada", "en_curso", "pausada", "terminada", "cancelada"]), startDate: optionalDate, endDate: optionalDate, budgetCents: cents, costCenter: optionalText, checklist: z.array(z.object({ _id: optionalId, title: text, done: z.boolean().default(false), completedAt: optionalDate, createdAt: optionalDate, updatedAt: optionalDate })).optional(), certificates: z.array(z.any()).optional(), labor: z.array(z.any()).optional() }),
  workers: z.object({ firstName: text, lastName: text, dni: z.string().trim().transform(v => v.replace(/\D/g, "")).refine(v => v.length >= 7 && v.length <= 8, "El DNI tiene que tener 7 u 8 dígitos"), phone: optionalText, category: z.enum(["capataz", "oficial", "medio_oficial", "ayudante", "especialista"]), rateMode: z.enum(["jornada", "hora"]).default("jornada"), dailyRateCents: cents.default(0), hoursPerDay: z.coerce.number().min(1).max(24).default(8), hourlyRateCents: cents.default(0), notes: optionalText, active: z.boolean().optional().default(true) }),
  // El descuento va sin default: un PATCH parcial no tiene que volverlo a cero.
  suppliers: z.object({ name: text, contactName: optionalText, email: optionalText, phone: optionalText, address: optionalText, notes: optionalText, discountPct: z.coerce.number().min(0, "El descuento no puede ser negativo").max(100, "El descuento no puede pasar el 100%").optional(), active: z.boolean().optional().default(true) }),
  stock: z.object({ name: text, sku: optionalText, category: z.enum(["materiales", "herramientas", "seguridad", "consumibles", "otros"]), unit: z.enum(["unidad", "kg", "litro", "metro", "m2", "m3", "bolsa", "balde", "rollo"]), minQuantity: z.coerce.number().min(0).default(0), supplierId: optionalId, location: optionalText, notes: optionalText, active: z.boolean().optional().default(true) }),
  purchases: z.object({ number: text, supplierId: optionalId, workId: optionalId, description: text, amountCents: cents, stage: z.enum(["solicitud", "orden", "recepcion"]), status: z.enum(["borrador", "aprobada", "enviada", "recibida", "cancelada"]), requestedDate: date, expectedDate: optionalDate, receivedDate: optionalDate, receiptNotes: optionalText }),
  expenses: z.object({ number: optionalText, supplierId: optionalId, workId: optionalId, description: text, category: z.enum(["materiales", "transporte", "combustible", "servicios", "costo_indirecto", "gasto_fijo", "mano_obra"]), amountCents: cents, issueDate: date, dueDate: optionalDate, status: z.enum(["pendiente", "parcial", "pagado", "anulado"]), paidCents: cents.default(0), attachment: optionalText }),
  invoices: z.object({ number: text, clientId: id, workId: optionalId, certificateNumber: optionalText, description: optionalText, issueDate: date, dueDate: optionalDate, amountCents: cents, collectedCents: cents.default(0), status: z.enum(["pendiente", "parcial", "cobrada", "anulada"]), attachment: optionalText }),
  collections: z.object({ clientId: id, invoiceId: optionalId, date, amountCents: cents, method: z.enum(["transferencia", "efectivo", "cheque", "retencion", "otro"]), account: optionalText, reference: optionalText, notes: optionalText }),
  payments: z.object({ supplierId: optionalId, expenseId: optionalId, date, amountCents: cents, method: z.enum(["transferencia", "efectivo", "cheque", "otro"]), account: optionalText, reference: optionalText, notes: optionalText }),
  checks: z.object({ direction: z.enum(["recibido", "emitido"]), bank: text, number: text, issuer: optionalText, amountCents: cents, dueDate: date, status: z.enum(["cartera", "depositado", "cobrado", "endosado", "rechazado", "emitido"]), clientId: optionalId, supplierId: optionalId }),
  cash: z.object({ date, direction: z.enum(["ingreso", "egreso"]), account: text, category: text, description: text, amountCents: cents, reference: optionalText, reconciled: z.boolean().optional().default(false) }),
  tasks: z.object({ title: text, description: optionalText, type: z.enum(["general", "facturar_certificado", "cobranza", "vencimiento"]), status: z.enum(["pendiente", "en_curso", "completada"]), dueDate: optionalDate, assigneeRole: z.union([z.enum(["gerencia", "arquitecto", "auxiliar", "administracion", "compras", "ventas", "contador"]), z.literal("")]).optional().transform(v => v || undefined), assigneeId: optionalId, relatedType: optionalText, relatedId: optionalId }),
};

/*
 * El payload del cotizador cascada. No va dentro de `schemas` porque no es una
 * entidad: se guarda por su propia ruta (PUT /api/quotes/[id]/cascada), que
 * recalcula la cascada en el servidor y de ahi escribe amountCents.
 */
const coef = z.coerce.number().min(0);
const insumo = z.object({
  rubro: z.enum(["MAT", "MO", "EQUIPOS"]).default("MAT"),
  code: optionalText,
  name: text,
  unit: z.string().trim().max(20).default("u"),
  coefPerUnit: coef.default(0),
  unitPriceCents: cents.default(0),
  currency: z.enum(["ARS", "USD"]).default("ARS"),
  fxRate: z.coerce.number().min(0).default(0),
  stockItemId: optionalId,
  workerId: optionalId,
  personas: z.coerce.number().min(0).default(0),
});

export const cascadaPayload = z.object({
  items: z.array(z.object({
    code: optionalText,
    name: text,
    unit: z.string().trim().max(20).default("m2"),
    qty: coef.default(0),
    detail: optionalText,
    composition: z.array(insumo).default([]),
  })).default([]),
  overheads: z.array(z.object({
    conceptKey: text,
    group: optionalText, label: optionalText, unit: optionalText,
    qty: coef.default(0),
    unitPriceCents: cents.default(0),
    formula: z.enum(["impuesto_cheque", "representacion_tecnica", "mes_hombre"]).optional(),
    // Los porcentajes no son dinero: llevan decimales y no van en centavos.
    formulaPct: z.coerce.number().min(0).max(100).optional(),
    personas: z.coerce.number().min(0).optional(),
    dias: z.coerce.number().min(0).optional(),
  })).default([]),
  cascade: z.object({
    ggiPct: z.coerce.number().min(0).max(100).default(18),
    // El beneficio puede ser negativo cuando se despeja desde un precio que no cubre el costo.
    benefitPct: z.coerce.number().min(-100).max(1000).default(30),
    financialPct: z.coerce.number().min(0).max(100).default(0),
    iibbPct: z.coerce.number().min(0).max(100).default(2.5),
    ivaPct: z.coerce.number().min(0).max(100).default(21),
    ivaBase: z.enum(["st2", "st3"]).default("st2"),
    chequePct: z.coerce.number().min(0).max(100).default(0),
  }).default({ ggiPct: 18, benefitPct: 30, financialPct: 0, iibbPct: 2.5, ivaPct: 21, ivaBase: "st2", chequePct: 0 }),
});

/*
 * Obras: el avance fisico (`progress`) y los avances manuales (`advances`) ya no
 * entran por el formulario. El avance lo recalcula el cierre de una inspeccion
 * y los avances viejos quedan como registro. Zod descarta esas claves si llegan.
 */

/** La base del avance: PUT /api/works/[id]/progress-base. */
export const progressBasePayload = z.object({
  lines: z.array(z.object({
    _id: optionalId,
    rubro: z.enum(INSPECTION_RUBROS),
    label: text.max(160),
    unit: z.string().trim().max(20).default("m2"),
    plannedQty: z.coerce.number().min(0).default(0),
    initialQty: z.coerce.number().min(0).default(0),
    amountCents: cents.default(0),
  })).max(60),
});

/** Alta de una inspeccion: solo el dia y el rubro. El resto se arma en el servidor. */
export const inspectionCreatePayload = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"), rubro: z.enum(INSPECTION_RUBROS) });

// Un numero que puede venir vacio desde el formulario: vacio es "no cargado", no cero.
const maybeQty = z.union([z.literal(""), z.null(), z.coerce.number().min(0)]).optional().transform(v => v === "" || v === null || v === undefined ? undefined : v);
const shortText = z.string().trim().max(500).optional().default("");
const longText = z.string().trim().max(5000).optional().default("");
const optionOrBlank = <T extends readonly [string, ...string[]]>(values: T) => z.union([z.enum(values), z.literal("")]).optional().default("");
const check = z.object({ key: z.string().max(60), label: z.string().max(400), result: optionOrBlank(CHECK_RESULTS), notes: shortText });
const time = z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal("")]).optional().default("");
const photo = z.string().regex(/^\/api\/uploads\/[a-f\d-]+\.(jpg|png|webp)$/i);

/**
 * Lo que se guarda de un borrador (PATCH). Los puntos de control viajan con su
 * texto, pero el servidor solo toma resultado y observaciones de los que ya
 * estaban copiados: la plantilla no se reescribe desde el navegador.
 */
export const inspectionPayload = z.object({
  managerName: shortText, weather: optionOrBlank(WEATHER), qualityResponsibleName: shortText,
  staff: z.object({
    source: z.enum(["partes", "manual"]).default("partes"),
    oficiales: z.coerce.number().int().min(0).max(500).default(0), medioOficiales: z.coerce.number().int().min(0).max(500).default(0),
    ayudantes: z.coerce.number().int().min(0).max(500).default(0), otros: z.coerce.number().int().min(0).max(500).default(0),
    hoursWorked: z.coerce.number().min(0).max(10000).default(0), checkIn: time, checkOut: time,
  }).partial().optional(),
  production: z.array(z.object({ lineId: optionalId, label: z.string().trim().max(160).optional().default(""), unit: z.string().trim().max(20).optional().default(""), todayQty: maybeQty })).max(60).optional(),
  stage: shortText, performance: optionOrBlank(PERFORMANCE), lowPerformanceReason: shortText, productionConsumption: optionOrBlank(PRODUCTION_CONSUMPTION),
  quality: z.array(check).max(60).optional(), qualityNotes: longText,
  materialsReceived: z.array(z.object({
    source: z.enum(["stock", "manual"]).default("manual"), stockItemId: optionalId, movementId: optionalId,
    name: z.string().trim().max(160), unit: z.string().trim().max(20).optional().default(""), quantity: z.coerce.number().min(0).default(0),
    condition: optionOrBlank(MATERIAL_CONDITIONS), notes: shortText,
  })).max(60).optional(),
  mainMaterial: z.object({
    stockItemId: optionalId, name: z.string().trim().max(160).optional().default(""), unit: z.string().trim().max(20).optional().default(""),
    plannedQty: maybeQty, stockStart: maybeQty, receivedToday: maybeQty, stockEnd: maybeQty, notes: shortText,
  }).optional(),
  shortages: z.array(z.object({ material: z.string().trim().max(160), quantity: z.coerce.number().min(0).default(0), unit: z.string().trim().max(20).optional().default("") })).max(40).optional(),
  shortageNeededBy: optionalDate, shortageOrderStatus: optionOrBlank(ORDER_STATUS),
  safety: z.array(check).max(20).optional(), incidents: longText,
  colors: z.array(z.object({ sector: z.string().trim().max(80), color: shortText, paintType: shortText, brand: shortText, notes: shortText })).max(40).optional(),
  photos: z.array(photo).max(12).optional(),
  notes: longText,
}).partial();

export function sanitizeSearch(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 100); }
