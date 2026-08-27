import mongoose, { Schema } from "mongoose";
import { entities, ROLES, viewSections } from "./constants";

const options = { timestamps: true, strict: true } as const;
const money = { type: Number, min: 0, default: 0 };

const UserSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ROLES, required: true },
  active: { type: Boolean, default: true },
  permissions: {
    type: new Schema({
      view: [{ type: String, enum: viewSections }],
      edit: [{ type: String, enum: entities }],
    }, { _id: false }),
    default: undefined,
  },
}, options);

const ClientSchema = new Schema({
  name: { type: String, required: true, trim: true },
  cuit: { type: String, trim: true },
  contactName: String, email: String,
  // Un cliente puede tener varios telefonos (obra, administracion, celular del contacto).
  phones: { type: [String], default: [] },
  address: String, notes: String, active: { type: Boolean, default: true },
}, options);

const QuoteSchema = new Schema({
  number: { type: String, required: true, unique: true, trim: true },
  clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
  title: { type: String, required: true }, description: String,
  version: { type: Number, default: 1, min: 1 }, amountCents: money,
  estimatedCostCents: money,
  status: { type: String, enum: ["borrador", "enviada", "seguimiento", "aprobada", "rechazada", "vencida", "convertida"], default: "borrador" },
  ownerId: { type: Schema.Types.ObjectId, ref: "User" }, validUntil: Date,
  workId: { type: Schema.Types.ObjectId, ref: "Work" },
  attachment: String,
  history: [{ action: String, note: String, at: { type: Date, default: Date.now }, userId: Schema.Types.ObjectId, userName: String }],
}, options);

const CounterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });

const ChecklistItemSchema = new Schema({
  title: { type: String, required: true, trim: true },
  done: { type: Boolean, default: false },
  completedAt: Date,
}, { timestamps: true });

const WorkActivitySchema = new Schema({
  detail: { type: String, required: true, trim: true },
  photos: [{ type: String }],
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  authorName: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

const WorkSchema = new Schema({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true }, clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
  quoteId: { type: Schema.Types.ObjectId, ref: "Quote" }, managerId: { type: Schema.Types.ObjectId, ref: "User" },
  status: { type: String, enum: ["planificada", "en_curso", "pausada", "terminada", "cancelada"], default: "planificada" },
  startDate: Date, endDate: Date, budgetCents: money, progress: { type: Number, min: 0, max: 100, default: 0 },
  costCenter: String,
  checklist: [ChecklistItemSchema],
  activity: [WorkActivitySchema],
  advances: [{ percentage: Number, note: String, date: Date, userId: Schema.Types.ObjectId, photos: [String] }],
  certificates: [{ number: String, period: String, percentage: Number, amountCents: Number, approved: Boolean, invoiced: Boolean, file: String }],
  // Se guardan los datos del trabajador junto a la asignacion: la obra tiene que
  // poder mostrar nombre, DNI y telefono sin depender de otra consulta.
  assignedWorkers: [{
    workerId: { type: Schema.Types.ObjectId, ref: "Worker" },
    name: String, dni: String, phone: String, category: String,
    // Los valores se pueden retocar por obra sin tocar el legajo: la misma
    // persona puede cobrar distinto segun donde trabaje.
    rateMode: { type: String, enum: ["jornada", "hora"], default: "jornada" },
    dailyRateCents: Number, hoursPerDay: Number, hourlyRateCents: Number,
    assignedAt: { type: Date, default: Date.now }, assignedByName: String,
  }],
  // Parte diario: quien, que dia y cuantas horas. El importe se congela con el
  // valor hora vigente al cargarlo, para que un cambio de jornal no reescriba el pasado.
  labor: [{
    workerId: { type: Schema.Types.ObjectId, ref: "Worker" },
    person: String, date: Date,
    // Se carga por jornada o por hora. Se guardan las dos medidas (jornadas y
    // horas) para que la liquidacion sume igual sin importar como se cargo.
    mode: { type: String, enum: ["jornada", "hora"], default: "hora" },
    hours: Number, days: Number,
    dailyRateCents: Number, hourlyRateCents: Number, costCents: Number,
    // Si alguien pisa el importe a mano, queda marcado y no se recalcula solo.
    manualCost: { type: Boolean, default: false },
    note: String, loadedByName: String, createdAt: { type: Date, default: Date.now },
  }],
}, options);

type WorkerDoc = {
  name?: string; firstName: string; lastName: string; dni: string; phone?: string;
  category?: string; rateMode?: "jornada" | "hora"; dailyRateCents?: number; hoursPerDay?: number;
  hourlyRateCents?: number; active?: boolean; notes?: string;
};

const WorkerSchema = new Schema<WorkerDoc>({
  // `name` se arma solo con apellido y nombre: es lo que muestran los listados,
  // los selects y el buscador, que trabajan siempre contra ese campo.
  name: { type: String, trim: true },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  dni: { type: String, required: true, trim: true },
  phone: { type: String, trim: true },
  category: { type: String, enum: ["capataz", "oficial", "medio_oficial", "ayudante", "especialista"], default: "oficial" },
  // El valor del jornal es el dato que maneja la empresa; el valor hora sale de
  // dividirlo, salvo que se cargue uno propio.
  rateMode: { type: String, enum: ["jornada", "hora"], default: "jornada" },
  dailyRateCents: { type: Number, min: 0, default: 0 },
  hoursPerDay: { type: Number, min: 1, max: 24, default: 8 },
  hourlyRateCents: { type: Number, min: 0, default: 0 },
  active: { type: Boolean, default: true },
  notes: String,
}, options);

const SupplierSchema = new Schema({
  name: { type: String, required: true }, contactName: String, email: String, phone: String,
  address: String, notes: String, active: { type: Boolean, default: true },
}, options);

// Cada entrada y salida de un material queda guardada: el stock actual es la
// consecuencia de los movimientos, no un numero que alguien escribe a mano.
const StockMovementSchema = new Schema({
  kind: { type: String, enum: ["ingreso", "egreso", "ajuste"], required: true },
  quantity: { type: Number, required: true },
  unitCostCents: { type: Number, min: 0, default: 0 },
  totalCents: { type: Number, min: 0, default: 0 },
  supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" },
  workId: { type: Schema.Types.ObjectId, ref: "Work" },
  reference: String, note: String,
  date: { type: Date, default: Date.now },
  userId: { type: Schema.Types.ObjectId, ref: "User" }, userName: String,
  // Rastro cruzado con los otros modulos, para poder auditar el circuito completo.
  purchaseId: { type: Schema.Types.ObjectId, ref: "Purchase" },
  expenseId: { type: Schema.Types.ObjectId, ref: "Expense" },
}, { timestamps: { createdAt: true, updatedAt: false } });

const StockItemSchema = new Schema({
  name: { type: String, required: true, trim: true },
  sku: { type: String, trim: true },
  category: { type: String, enum: ["materiales", "herramientas", "seguridad", "consumibles", "otros"], default: "materiales" },
  unit: { type: String, enum: ["unidad", "kg", "litro", "metro", "m2", "m3", "bolsa", "balde", "rollo"], default: "unidad" },
  quantity: { type: Number, default: 0 },
  minQuantity: { type: Number, min: 0, default: 0 },
  // Costo promedio ponderado: cada compra a distinto precio lo recalcula.
  avgCostCents: { type: Number, min: 0, default: 0 },
  valueCents: { type: Number, min: 0, default: 0 },
  supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" },
  location: String, notes: String, active: { type: Boolean, default: true },
  movements: [StockMovementSchema],
}, options);

const PurchaseSchema = new Schema({
  number: { type: String, required: true, unique: true }, supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" }, workId: { type: Schema.Types.ObjectId, ref: "Work" },
  description: { type: String, required: true }, amountCents: money,
  stage: { type: String, enum: ["solicitud", "orden", "recepcion"], default: "solicitud" },
  status: { type: String, enum: ["borrador", "aprobada", "enviada", "recibida", "cancelada"], default: "borrador" },
  requestedDate: { type: Date, required: true }, expectedDate: Date, receivedDate: Date, receiptNotes: String,
}, options);

const ExpenseSchema = new Schema({
  number: String, supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" }, workId: { type: Schema.Types.ObjectId, ref: "Work" },
  description: { type: String, required: true },
  category: { type: String, enum: ["materiales", "transporte", "combustible", "servicios", "costo_indirecto", "gasto_fijo", "mano_obra"], required: true },
  amountCents: money, issueDate: { type: Date, required: true }, dueDate: Date,
  status: { type: String, enum: ["pendiente", "parcial", "pagado", "anulado"], default: "pendiente" },
  paidCents: money, attachment: String,
}, options);

const InvoiceSchema = new Schema({
  number: { type: String, required: true }, clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
  workId: { type: Schema.Types.ObjectId, ref: "Work" }, certificateNumber: String,
  description: String, issueDate: { type: Date, required: true }, dueDate: Date,
  amountCents: money, collectedCents: money,
  status: { type: String, enum: ["pendiente", "parcial", "cobrada", "anulada"], default: "pendiente" }, attachment: String,
}, options);
InvoiceSchema.index({ number: 1, clientId: 1 }, { unique: true });

const CollectionSchema = new Schema({
  clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true }, invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
  date: { type: Date, required: true }, amountCents: money,
  method: { type: String, enum: ["transferencia", "efectivo", "cheque", "retencion", "otro"], required: true },
  account: String, reference: String, notes: String,
}, options);

const PaymentSchema = new Schema({
  supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" }, expenseId: { type: Schema.Types.ObjectId, ref: "Expense" },
  date: { type: Date, required: true }, amountCents: money,
  method: { type: String, enum: ["transferencia", "efectivo", "cheque", "otro"], required: true },
  account: String, reference: String, notes: String,
}, options);

const CheckSchema = new Schema({
  direction: { type: String, enum: ["recibido", "emitido"], required: true },
  bank: { type: String, required: true }, number: { type: String, required: true }, issuer: String,
  amountCents: money, dueDate: { type: Date, required: true },
  status: { type: String, enum: ["cartera", "depositado", "cobrado", "endosado", "rechazado", "emitido"], default: "cartera" },
  clientId: { type: Schema.Types.ObjectId, ref: "Client" }, supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" },
}, options);

const CashSchema = new Schema({
  date: { type: Date, required: true }, direction: { type: String, enum: ["ingreso", "egreso"], required: true },
  account: { type: String, required: true }, category: { type: String, required: true }, description: { type: String, required: true },
  amountCents: money, reference: String, reconciled: { type: Boolean, default: false },
}, options);

const TaskSchema = new Schema({
  title: { type: String, required: true }, description: String,
  type: { type: String, enum: ["general", "facturar_certificado", "cobranza", "vencimiento"], default: "general" },
  status: { type: String, enum: ["pendiente", "en_curso", "completada"], default: "pendiente" },
  // Una tarea se asigna a un area (assigneeRole) y, si hace falta, a una persona
  // concreta. El nombre se copia para poder listarlo sin ir a buscar el usuario.
  dueDate: Date, assigneeRole: { type: String, enum: ROLES },
  assigneeId: { type: Schema.Types.ObjectId, ref: "User" }, assigneeName: String,
  relatedType: String, relatedId: Schema.Types.ObjectId,
}, options);

const AuditSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User" }, userName: String, userEmail: String,
  action: { type: String, required: true }, entity: { type: String, required: true }, entityId: Schema.Types.ObjectId,
  before: Schema.Types.Mixed, after: Schema.Types.Mixed, ip: String,
}, { timestamps: { createdAt: true, updatedAt: false } });

const NotificationSchema = new Schema({
  title: { type: String, required: true, trim: true },
  body: { type: String, default: "" },
  kind: { type: String, enum: ["obra", "certificado", "cotizacion", "cobranza", "vencimiento", "stock", "general"], default: "general" },
  href: String,
  roles: [{ type: String, enum: ROLES }],
  // "hecha" la saca de la campanita para siempre; "pospuesta" la esconde hasta remindAt.
  status: { type: String, enum: ["pendiente", "pospuesta", "hecha"], default: "pendiente" },
  remindAt: Date,
  doneAt: Date, doneByName: String,
  dedupeKey: { type: String, index: true },
}, options);

export const User = mongoose.models.User || mongoose.model("User", UserSchema);
export const Client = mongoose.models.Client || mongoose.model("Client", ClientSchema);
export const Quote = mongoose.models.Quote || mongoose.model("Quote", QuoteSchema);
export const Work = mongoose.models.Work || mongoose.model("Work", WorkSchema);
export const StockItem = mongoose.models.StockItem || mongoose.model("StockItem", StockItemSchema);
export const Worker = mongoose.models.Worker || mongoose.model("Worker", WorkerSchema);
export const Supplier = mongoose.models.Supplier || mongoose.model("Supplier", SupplierSchema);
export const Purchase = mongoose.models.Purchase || mongoose.model("Purchase", PurchaseSchema);
export const Expense = mongoose.models.Expense || mongoose.model("Expense", ExpenseSchema);
export const Invoice = mongoose.models.Invoice || mongoose.model("Invoice", InvoiceSchema);
export const Collection = mongoose.models.Collection || mongoose.model("Collection", CollectionSchema);
export const Payment = mongoose.models.Payment || mongoose.model("Payment", PaymentSchema);
export const Check = mongoose.models.Check || mongoose.model("Check", CheckSchema);
export const CashMovement = mongoose.models.CashMovement || mongoose.model("CashMovement", CashSchema);
export const Task = mongoose.models.Task || mongoose.model("Task", TaskSchema);
export const AuditLog = mongoose.models.AuditLog || mongoose.model("AuditLog", AuditSchema);
export const Notification = mongoose.models.Notification || mongoose.model("Notification", NotificationSchema);
export const Counter = mongoose.models.Counter || mongoose.model("Counter", CounterSchema);

// COT-1: numeración correlativa. La primera vez arranca desde el número más alto ya cargado
// para no pisar los que vienen del sistema anterior (llegan hasta COT-747).
/** El listado, el buscador y los selects trabajan contra `name`: se arma acá. */
export function composeWorkerName(doc: { firstName?: unknown; lastName?: unknown }) {
  return [doc.lastName, doc.firstName].filter(Boolean).map(String).join(", ");
}

/**
 * Version de una cotizacion nueva.
 *
 * Las revisiones de un mismo trabajo se escriben con el mismo titulo: la
 * primera es la 1 y cada una que llega despues toma el numero siguiente, asi
 * queda claro cual es la ultima que vio el cliente. No se elige a mano.
 */
export async function nextQuoteVersion(title: string) {
  const clean = String(title || "").trim();
  if (!clean) return 1;
  // El titulo lo escribe una persona: se compara literal y sin distinguir mayusculas.
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const [highest] = await Quote.find({ title: { $regex: `^${escaped}$`, $options: "i" } }).sort({ version: -1 }).limit(1).lean();
  return Math.max(1, Number(highest?.version || 0) + 1);
}

export async function nextQuoteNumber() {
  if (!await Counter.exists({ _id: "quotes" })) {
    const [highest] = await Quote.aggregate([
      { $match: { number: /^COT-\d+$/ } },
      { $project: { seq: { $toInt: { $substr: ["$number", 4, -1] } } } },
      { $sort: { seq: -1 } }, { $limit: 1 },
    ]);
    await Counter.updateOne({ _id: "quotes" }, { $setOnInsert: { seq: highest?.seq || 0 } }, { upsert: true });
  }
  const counter = await Counter.findByIdAndUpdate("quotes", { $inc: { seq: 1 } }, { new: true });
  return `COT-${counter.seq}`;
}

export const modelByEntity ={ clients: Client, quotes: Quote, works: Work, workers: Worker, suppliers: Supplier, stock: StockItem, purchases: Purchase, expenses: Expense, invoices: Invoice, collections: Collection, payments: Payment, checks: Check, cash: CashMovement, tasks: Task } as const;
