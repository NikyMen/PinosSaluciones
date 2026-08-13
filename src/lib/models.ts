import mongoose, { Schema } from "mongoose";
import { ROLES } from "./constants";

const options = { timestamps: true, strict: true } as const;
const money = { type: Number, min: 0, default: 0 };

const UserSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ROLES, required: true },
  active: { type: Boolean, default: true },
}, options);

const ClientSchema = new Schema({
  name: { type: String, required: true, trim: true },
  contactName: String, email: String, phone: String, whatsapp: String,
  address: String, notes: String, active: { type: Boolean, default: true },
}, options);

const QuoteSchema = new Schema({
  number: { type: String, required: true, unique: true, trim: true },
  clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
  title: { type: String, required: true }, description: String,
  version: { type: Number, default: 1, min: 1 }, amountCents: money,
  estimatedCostCents: money,
  status: { type: String, enum: ["borrador", "enviada", "seguimiento", "aprobada", "rechazada", "vencida"], default: "borrador" },
  ownerId: { type: Schema.Types.ObjectId, ref: "User" }, validUntil: Date,
  attachment: String,
  history: [{ action: String, note: String, at: { type: Date, default: Date.now }, userId: Schema.Types.ObjectId }],
}, options);

const WorkSchema = new Schema({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true }, clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
  quoteId: { type: Schema.Types.ObjectId, ref: "Quote" }, managerId: { type: Schema.Types.ObjectId, ref: "User" },
  status: { type: String, enum: ["planificada", "en_curso", "pausada", "terminada", "cancelada"], default: "planificada" },
  startDate: Date, endDate: Date, budgetCents: money, progress: { type: Number, min: 0, max: 100, default: 0 },
  costCenter: String,
  checklist: [{ title: String, done: { type: Boolean, default: false }, completedAt: Date }],
  advances: [{ percentage: Number, note: String, date: Date, userId: Schema.Types.ObjectId, photos: [String] }],
  certificates: [{ number: String, period: String, percentage: Number, amountCents: Number, approved: Boolean, invoiced: Boolean, file: String }],
  labor: [{ person: String, date: Date, hours: Number, costCents: Number }],
}, options);

const SupplierSchema = new Schema({
  name: { type: String, required: true }, contactName: String, email: String, phone: String,
  address: String, notes: String, active: { type: Boolean, default: true },
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
  dueDate: Date, assigneeRole: { type: String, enum: ROLES }, relatedType: String, relatedId: Schema.Types.ObjectId,
}, options);

const AuditSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User" }, userName: String,
  action: { type: String, required: true }, entity: { type: String, required: true }, entityId: Schema.Types.ObjectId,
  before: Schema.Types.Mixed, after: Schema.Types.Mixed, ip: String,
}, { timestamps: { createdAt: true, updatedAt: false } });

export const User = mongoose.models.User || mongoose.model("User", UserSchema);
export const Client = mongoose.models.Client || mongoose.model("Client", ClientSchema);
export const Quote = mongoose.models.Quote || mongoose.model("Quote", QuoteSchema);
export const Work = mongoose.models.Work || mongoose.model("Work", WorkSchema);
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

export const modelByEntity = { clients: Client, quotes: Quote, works: Work, suppliers: Supplier, purchases: Purchase, expenses: Expense, invoices: Invoice, collections: Collection, payments: Payment, checks: Check, cash: CashMovement, tasks: Task } as const;
