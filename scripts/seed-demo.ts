import mongoose from "mongoose";
import { connectDB } from "../src/lib/db";

type SeedDocument = mongoose.mongo.Document;

let inserted = 0;
let reused = 0;

function pesos(value: number) {
  return Math.round(value * 100);
}

function monthDate(monthsAgo: number, day = 10) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, day, 12, 0, 0);
}

async function ensure(
  collection: mongoose.mongo.Collection,
  filter: SeedDocument,
  document: SeedDocument,
) {
  const result = await collection.updateOne(filter, { $setOnInsert: document }, { upsert: true });
  if (result.upsertedCount) inserted += 1;
  else reused += 1;
  const saved = await collection.findOne(filter, { projection: { _id: 1 } });
  if (!saved?._id) throw new Error(`No se pudo resolver el registro demo ${JSON.stringify(filter)}`);
  return saved._id;
}

async function main() {
  await connectDB();
  const db = mongoose.connection;
  const now = new Date();

  const clients = db.collection("clients");
  const suppliers = db.collection("suppliers");
  const quotes = db.collection("quotes");
  const works = db.collection("works");
  const purchases = db.collection("purchases");
  const invoices = db.collection("invoices");
  const collections = db.collection("collections");
  const expenses = db.collection("expenses");
  const payments = db.collection("payments");
  const checks = db.collection("checks");
  const tasks = db.collection("tasks");
  const cashMovements = db.collection("cashmovements");

  const clientDefinitions = [
    { key: "taragui", name: "Desarrollos Taragüí SRL (Demo)", contactName: "Contacto Comercial", email: "taragui.demo@pino.local", phone: "+54 379 400-0101", address: "Av. Costanera, Corrientes Capital" },
    { key: "costanera", name: "Consorcio Costanera Norte (Demo)", contactName: "Administración Demo", email: "costanera.demo@pino.local", phone: "+54 379 400-0102", address: "Barrio Cambá Cuá, Corrientes Capital" },
    { key: "parana", name: "Logística Paraná SRL (Demo)", contactName: "Operaciones Demo", email: "parana.demo@pino.local", phone: "+54 379 400-0103", address: "Santa Catalina, Corrientes Capital" },
    { key: "laguna", name: "Inversiones Laguna Brava (Demo)", contactName: "Dirección Demo", email: "laguna.demo@pino.local", phone: "+54 379 400-0104", address: "Ruta Provincial 5, Corrientes" },
    { key: "guarani", name: "Centro Guaraní (Demo)", contactName: "Coordinación Demo", email: "guarani.demo@pino.local", phone: "+54 379 400-0105", address: "Av. 3 de Abril, Corrientes Capital" },
    { key: "riachuelo", name: "Estudio Riachuelo (Demo)", contactName: "Proyectos Demo", email: "riachuelo.demo@pino.local", phone: "+54 379 400-0106", address: "Riachuelo, Corrientes" },
  ];
  const clientIds = new Map<string, mongoose.mongo.BSON.ObjectId>();
  for (const definition of clientDefinitions) {
    const { key, ...data } = definition;
    const id = await ensure(clients, { name: data.name }, { ...data, whatsapp: data.phone, notes: "Dato ficticio para demostración", active: true, createdAt: monthDate(11), updatedAt: now });
    clientIds.set(key, id);
  }

  const supplierDefinitions = [
    { key: "materiales", name: "Materiales del Litoral (Demo)", contactName: "Ventas Demo", email: "materiales.demo@pino.local", phone: "+54 379 410-0201", address: "Av. Independencia, Corrientes" },
    { key: "hormigon", name: "Hormigones Taragüí (Demo)", contactName: "Despacho Demo", email: "hormigon.demo@pino.local", phone: "+54 379 410-0202", address: "Parque Industrial Santa Catalina" },
    { key: "electricidad", name: "Electro Nordeste (Demo)", contactName: "Cuentas Demo", email: "electro.demo@pino.local", phone: "+54 379 410-0203", address: "Corrientes Capital" },
    { key: "aberturas", name: "Aberturas Paraná (Demo)", contactName: "Taller Demo", email: "aberturas.demo@pino.local", phone: "+54 379 410-0204", address: "Santa Ana, Corrientes" },
    { key: "servicios", name: "Servicios Técnicos Iberá (Demo)", contactName: "Coordinación Demo", email: "ibera.demo@pino.local", phone: "+54 379 410-0205", address: "Corrientes Capital" },
  ];
  const supplierIds = new Map<string, mongoose.mongo.BSON.ObjectId>();
  for (const definition of supplierDefinitions) {
    const { key, ...data } = definition;
    const id = await ensure(suppliers, { name: data.name }, { ...data, notes: "Dato ficticio para demostración", active: true, createdAt: monthDate(11), updatedAt: now });
    supplierIds.set(key, id);
  }

  const quoteDefinitions = [
    { key: "camba", number: "DEMO-COT-001", client: "costanera", title: "Readecuación de oficinas Cambá Cuá", amount: 185_000_000, cost: 132_000_000, status: "aprobada", age: 5 },
    { key: "costanera", number: "DEMO-COT-002", client: "taragui", title: "Locales comerciales Costanera Sur", amount: 248_000_000, cost: 176_000_000, status: "aprobada", age: 4 },
    { key: "santa", number: "DEMO-COT-003", client: "parana", title: "Nave logística Santa Catalina", amount: 365_000_000, cost: 268_000_000, status: "aprobada", age: 3 },
    { key: "laguna", number: "DEMO-COT-004", client: "laguna", title: "Ampliación residencial Laguna Brava", amount: 142_000_000, cost: 99_000_000, status: "aprobada", age: 2 },
    { key: "guarani", number: "DEMO-COT-005", client: "guarani", title: "Puesta en valor sede Guaraní", amount: 96_000_000, cost: 68_000_000, status: "seguimiento", age: 1 },
    { key: "riachuelo", number: "DEMO-COT-006", client: "riachuelo", title: "Depósito operativo Riachuelo", amount: 128_000_000, cost: 91_000_000, status: "enviada", age: 0 },
    { key: "historic1", number: "DEMO-COT-H01", client: "taragui", title: "Adecuación histórica demo", amount: 310_000_000, cost: 235_000_000, status: "aprobada", age: 7 },
    { key: "historic2", number: "DEMO-COT-H02", client: "guarani", title: "Obra histórica demo", amount: 214_000_000, cost: 164_000_000, status: "aprobada", age: 10 },
  ];
  const quoteIds = new Map<string, mongoose.mongo.BSON.ObjectId>();
  for (const quote of quoteDefinitions) {
    const timestamp = monthDate(quote.age, 8);
    const id = await ensure(quotes, { number: quote.number }, {
      number: quote.number, clientId: clientIds.get(quote.client), title: quote.title,
      description: "Cotización ficticia para tablero demo", version: 1,
      amountCents: pesos(quote.amount), estimatedCostCents: pesos(quote.cost), status: quote.status,
      validUntil: monthDate(Math.max(quote.age - 1, 0), 25), attachment: "",
      history: [{ action: `Estado: ${quote.status}`, note: "Carga demo", at: timestamp }],
      createdAt: timestamp, updatedAt: timestamp,
    });
    quoteIds.set(quote.key, id);
  }

  const workDefinitions = [
    { key: "camba", code: "DEMO-OB-001", name: "Readecuación de oficinas Cambá Cuá", client: "costanera", quote: "camba", budget: 185_000_000, progress: 28, startAge: 5, endAhead: -3, center: "CC-CAMBA" },
    { key: "costanera", code: "DEMO-OB-002", name: "Locales comerciales Costanera Sur", client: "taragui", quote: "costanera", budget: 248_000_000, progress: 46, startAge: 4, endAhead: -2, center: "CC-COSTA" },
    { key: "santa", code: "DEMO-OB-003", name: "Nave logística Santa Catalina", client: "parana", quote: "santa", budget: 365_000_000, progress: 67, startAge: 6, endAhead: -1, center: "CC-SANTA" },
    { key: "laguna", code: "DEMO-OB-004", name: "Ampliación residencial Laguna Brava", client: "laguna", quote: "laguna", budget: 142_000_000, progress: 83, startAge: 5, endAhead: 0, center: "CC-LAGUNA" },
  ];
  const workIds = new Map<string, mongoose.mongo.BSON.ObjectId>();
  for (const work of workDefinitions) {
    const id = await ensure(works, { code: work.code }, {
      code: work.code, name: work.name, clientId: clientIds.get(work.client), quoteId: quoteIds.get(work.quote),
      status: "en_curso", startDate: monthDate(work.startAge, 3), endDate: monthDate(work.endAhead, 26),
      budgetCents: pesos(work.budget), progress: work.progress, costCenter: work.center,
      checklist: [
        { title: "Replanteo y documentación", done: true, completedAt: monthDate(work.startAge, 8) },
        { title: "Control de materiales", done: true, completedAt: monthDate(Math.max(work.startAge - 1, 0), 12) },
        { title: "Próxima certificación", done: false },
      ],
      advances: [
        { percentage: Math.max(10, work.progress - 18), note: "Avance inicial demo", date: monthDate(2, 5) },
        { percentage: work.progress, note: "Actualización de avance demo", date: monthDate(0, 6) },
      ],
      certificates: [], labor: [], createdAt: monthDate(work.startAge, 3), updatedAt: monthDate(0, 6 + work.progress % 4),
    });
    workIds.set(work.key, id);
  }

  const invoiceDefinitions = [
    { number: "DEMO-FAC-001", work: "camba", client: "costanera", age: 5, amount: 36_000_000, collected: 36_000_000, dueShift: 4 },
    { number: "DEMO-FAC-002", work: "costanera", client: "taragui", age: 4, amount: 52_000_000, collected: 52_000_000, dueShift: 3 },
    { number: "DEMO-FAC-003", work: "santa", client: "parana", age: 3, amount: 74_000_000, collected: 48_000_000, dueShift: 2 },
    { number: "DEMO-FAC-004", work: "laguna", client: "laguna", age: 2, amount: 41_000_000, collected: 20_000_000, dueShift: 1 },
    { number: "DEMO-FAC-005", work: "camba", client: "costanera", age: 1, amount: 29_000_000, collected: 9_000_000, dueShift: 0 },
    { number: "DEMO-FAC-006", work: "costanera", client: "taragui", age: 0, amount: 38_000_000, collected: 0, dueShift: -1 },
    { number: "DEMO-FAC-H01", work: "santa", client: "parana", age: 7, amount: 86_000_000, collected: 86_000_000, dueShift: 6 },
    { number: "DEMO-FAC-H02", work: "laguna", client: "laguna", age: 10, amount: 48_000_000, collected: 48_000_000, dueShift: 9 },
  ];
  const invoiceIds = new Map<string, mongoose.mongo.BSON.ObjectId>();
  for (const invoice of invoiceDefinitions) {
    const status = invoice.collected >= invoice.amount ? "cobrada" : invoice.collected > 0 ? "parcial" : "pendiente";
    const id = await ensure(invoices, { number: invoice.number, clientId: clientIds.get(invoice.client) }, {
      number: invoice.number, clientId: clientIds.get(invoice.client), workId: workIds.get(invoice.work),
      certificateNumber: invoice.number.replace("FAC", "CERT"), description: "Certificado de avance demo",
      issueDate: monthDate(invoice.age, 12), dueDate: monthDate(invoice.dueShift, 20),
      amountCents: pesos(invoice.amount), collectedCents: pesos(invoice.collected), status, attachment: "",
      createdAt: monthDate(invoice.age, 12), updatedAt: monthDate(Math.max(invoice.age - 1, 0), 5),
    });
    invoiceIds.set(invoice.number, id);
  }

  for (const [index, invoice] of invoiceDefinitions.filter(item => item.collected > 0).entries()) {
    const reference = `DEMO-COB-${String(index + 1).padStart(3, "0")}`;
    await ensure(collections, { reference }, {
      clientId: clientIds.get(invoice.client), invoiceId: invoiceIds.get(invoice.number), date: monthDate(Math.max(invoice.age - 1, 0), 5),
      amountCents: pesos(invoice.collected), method: index % 3 === 0 ? "cheque" : "transferencia", account: "Banco Corrientes Demo",
      reference, notes: "Cobranza ficticia", createdAt: monthDate(Math.max(invoice.age - 1, 0), 5), updatedAt: monthDate(Math.max(invoice.age - 1, 0), 5),
    });
  }

  const expenseDefinitions = [
    { number: "DEMO-GAS-001", work: "camba", supplier: "materiales", age: 5, amount: 18_400_000, category: "materiales" },
    { number: "DEMO-GAS-002", work: "costanera", supplier: "electricidad", age: 4, amount: 24_700_000, category: "servicios" },
    { number: "DEMO-GAS-003", work: "santa", supplier: "hormigon", age: 3, amount: 46_800_000, category: "materiales" },
    { number: "DEMO-GAS-004", work: "laguna", supplier: "aberturas", age: 3, amount: 17_200_000, category: "materiales" },
    { number: "DEMO-GAS-005", work: "camba", supplier: "servicios", age: 2, amount: 13_600_000, category: "mano_obra" },
    { number: "DEMO-GAS-006", work: "costanera", supplier: "materiales", age: 2, amount: 21_900_000, category: "materiales" },
    { number: "DEMO-GAS-007", work: "santa", supplier: "servicios", age: 1, amount: 34_500_000, category: "mano_obra" },
    { number: "DEMO-GAS-008", work: "laguna", supplier: "electricidad", age: 1, amount: 11_800_000, category: "servicios" },
    { number: "DEMO-GAS-009", work: "camba", supplier: "materiales", age: 0, amount: 15_300_000, category: "materiales" },
    { number: "DEMO-GAS-010", work: "costanera", supplier: "aberturas", age: 0, amount: 19_600_000, category: "materiales" },
    { number: "DEMO-GAS-H01", work: "santa", supplier: "hormigon", age: 7, amount: 61_000_000, category: "materiales" },
    { number: "DEMO-GAS-H02", work: "laguna", supplier: "servicios", age: 10, amount: 35_000_000, category: "mano_obra" },
  ];
  const expenseIds = new Map<string, mongoose.mongo.BSON.ObjectId>();
  for (const expense of expenseDefinitions) {
    const paid = expense.age === 0 ? expense.amount * 0.35 : expense.amount;
    const id = await ensure(expenses, { number: expense.number }, {
      number: expense.number, supplierId: supplierIds.get(expense.supplier), workId: workIds.get(expense.work),
      description: `${expense.category.replace("_", " ")} - carga demo`, category: expense.category,
      amountCents: pesos(expense.amount), issueDate: monthDate(expense.age, 15), dueDate: monthDate(Math.max(expense.age - 1, 0), 8),
      status: paid >= expense.amount ? "pagado" : "parcial", paidCents: pesos(paid), attachment: "",
      createdAt: monthDate(expense.age, 15), updatedAt: monthDate(Math.max(expense.age - 1, 0), 8),
    });
    expenseIds.set(expense.number, id);
  }

  for (const [index, expense] of expenseDefinitions.entries()) {
    const paid = expense.age === 0 ? expense.amount * 0.35 : expense.amount;
    const reference = `DEMO-PAG-${String(index + 1).padStart(3, "0")}`;
    await ensure(payments, { reference }, {
      supplierId: supplierIds.get(expense.supplier), expenseId: expenseIds.get(expense.number), date: monthDate(Math.max(expense.age - 1, 0), 8),
      amountCents: pesos(paid), method: index % 4 === 0 ? "cheque" : "transferencia", account: "Banco Corrientes Demo",
      reference, notes: "Pago ficticio", createdAt: monthDate(Math.max(expense.age - 1, 0), 8), updatedAt: monthDate(Math.max(expense.age - 1, 0), 8),
    });
  }

  const purchaseDefinitions = [
    { number: "DEMO-OC-001", supplier: "materiales", work: "camba", description: "Materiales de terminación demo", amount: 16_800_000, status: "recibida" },
    { number: "DEMO-OC-002", supplier: "hormigon", work: "santa", description: "Hormigón estructural demo", amount: 44_500_000, status: "enviada" },
    { number: "DEMO-OC-003", supplier: "aberturas", work: "laguna", description: "Aberturas de aluminio demo", amount: 18_900_000, status: "aprobada" },
    { number: "DEMO-OC-004", supplier: "electricidad", work: "costanera", description: "Tableros y cableado demo", amount: 22_400_000, status: "borrador" },
  ];
  for (const [index, purchase] of purchaseDefinitions.entries()) {
    await ensure(purchases, { number: purchase.number }, {
      number: purchase.number, supplierId: supplierIds.get(purchase.supplier), workId: workIds.get(purchase.work),
      description: purchase.description, amountCents: pesos(purchase.amount), stage: purchase.status === "recibida" ? "recepcion" : "orden",
      status: purchase.status, requestedDate: monthDate(2 - Math.min(index, 2), 4), expectedDate: monthDate(0, 22),
      receivedDate: purchase.status === "recibida" ? monthDate(1, 18) : undefined, receiptNotes: "Orden ficticia",
      createdAt: monthDate(2 - Math.min(index, 2), 4), updatedAt: monthDate(0, 4 + index),
    });
  }

  const checkDefinitions = [
    { number: "DEMO-CH-001", bank: "Banco de Corrientes", direction: "recibido", status: "cartera", amount: 12_800_000, days: 3, client: "costanera" },
    { number: "DEMO-CH-002", bank: "Banco de Corrientes", direction: "emitido", status: "emitido", amount: 9_600_000, days: 6, supplier: "materiales" },
    { number: "DEMO-CH-003", bank: "Banco Nación", direction: "recibido", status: "cartera", amount: 18_400_000, days: 18, client: "parana" },
    { number: "DEMO-CH-004", bank: "Banco Galicia", direction: "recibido", status: "depositado", amount: 7_500_000, days: -4, client: "laguna" },
  ];
  for (const check of checkDefinitions) {
    const dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + check.days, 12);
    await ensure(checks, { number: check.number, bank: check.bank }, {
      direction: check.direction, bank: check.bank, number: check.number, issuer: "Emisor Demo", amountCents: pesos(check.amount), dueDate, status: check.status,
      clientId: check.client ? clientIds.get(check.client) : undefined, supplierId: check.supplier ? supplierIds.get(check.supplier) : undefined,
      createdAt: monthDate(0, 2), updatedAt: now,
    });
  }

  const taskDefinitions = [
    { title: "DEMO · Certificar avance Cambá Cuá", type: "facturar_certificado", role: "administracion", days: 2, status: "pendiente" },
    { title: "DEMO · Confirmar entrega Santa Catalina", type: "general", role: "compras", days: 1, status: "en_curso" },
    { title: "DEMO · Gestionar cobranza Costanera", type: "cobranza", role: "administracion", days: 3, status: "pendiente" },
    { title: "DEMO · Revisar terminaciones Laguna Brava", type: "general", role: "arquitecto", days: 5, status: "pendiente" },
    { title: "DEMO · Preparar cotización Guaraní", type: "general", role: "ventas", days: 7, status: "en_curso" },
    { title: "DEMO · Conciliar Banco Corrientes", type: "vencimiento", role: "administracion", days: 4, status: "pendiente" },
  ];
  for (const task of taskDefinitions) {
    await ensure(tasks, { title: task.title }, {
      title: task.title, description: "Tarea ficticia para demostración", type: task.type, status: task.status,
      dueDate: new Date(now.getFullYear(), now.getMonth(), now.getDate() + task.days, 12), assigneeRole: task.role,
      createdAt: monthDate(0, 1), updatedAt: now,
    });
  }

  const cashDefinitions = [
    { reference: "DEMO-CAJA-001", age: 5, direction: "ingreso", amount: 36_000_000, description: "Cobranza certificado demo" },
    { reference: "DEMO-CAJA-002", age: 4, direction: "egreso", amount: 24_700_000, description: "Pago servicios demo" },
    { reference: "DEMO-CAJA-003", age: 3, direction: "ingreso", amount: 48_000_000, description: "Cobranza parcial demo" },
    { reference: "DEMO-CAJA-004", age: 2, direction: "egreso", amount: 35_500_000, description: "Pago de materiales demo" },
    { reference: "DEMO-CAJA-005", age: 1, direction: "ingreso", amount: 29_000_000, description: "Ingreso operativo demo" },
    { reference: "DEMO-CAJA-006", age: 0, direction: "egreso", amount: 18_200_000, description: "Egreso operativo demo" },
  ];
  for (const movement of cashDefinitions) {
    await ensure(cashMovements, { reference: movement.reference }, {
      date: monthDate(movement.age, 9), direction: movement.direction, account: "Banco Corrientes Demo", category: "operación demo",
      description: movement.description, amountCents: pesos(movement.amount), reference: movement.reference, reconciled: movement.age > 0,
      createdAt: monthDate(movement.age, 9), updatedAt: monthDate(movement.age, 9),
    });
  }

  console.log(`Datos demo listos. Nuevos: ${inserted}. Existentes preservados: ${reused}.`);
  await mongoose.disconnect();
}

main().catch(async error => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ECONNREFUSED") || message.includes("MongooseServerSelectionError")) {
    console.error("MongoDB no disponible. Verificá MONGODB_URI y la accesibilidad de la base; luego ejecutá pnpm seed:demo nuevamente.");
  } else {
    console.error(error);
  }
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
