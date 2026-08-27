import { z } from "zod";
import type { Entity } from "./constants";

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
  works: z.object({ assignedWorkers: z.array(z.any()).optional(), code: text, name: text, clientId: id, quoteId: optionalId, managerId: optionalId, status: z.enum(["planificada", "en_curso", "pausada", "terminada", "cancelada"]), startDate: optionalDate, endDate: optionalDate, budgetCents: cents, progress: z.coerce.number().min(0).max(100), costCenter: optionalText, checklist: z.array(z.object({ _id: optionalId, title: text, done: z.boolean().default(false), completedAt: optionalDate, createdAt: optionalDate, updatedAt: optionalDate })).optional(), advances: z.array(z.any()).optional(), certificates: z.array(z.any()).optional(), labor: z.array(z.any()).optional() }),
  workers: z.object({ firstName: text, lastName: text, dni: z.string().trim().transform(v => v.replace(/\D/g, "")).refine(v => v.length >= 7 && v.length <= 8, "El DNI tiene que tener 7 u 8 dígitos"), phone: optionalText, category: z.enum(["capataz", "oficial", "medio_oficial", "ayudante", "especialista"]), rateMode: z.enum(["jornada", "hora"]).default("jornada"), dailyRateCents: cents.default(0), hoursPerDay: z.coerce.number().min(1).max(24).default(8), hourlyRateCents: cents.default(0), notes: optionalText, active: z.boolean().optional().default(true) }),
  suppliers: z.object({ name: text, contactName: optionalText, email: optionalText, phone: optionalText, address: optionalText, notes: optionalText, active: z.boolean().optional().default(true) }),
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

export function sanitizeSearch(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 100); }
