import mongoose from "mongoose";

/**
 * Pasa las compras al circuito nuevo (requerimiento integral v4, punto 2).
 *
 * - Las solicitudes tenían número OC-n, como las órdenes. Pasan a SC-n con su
 *   propio contador; el número viejo queda en `legacyNumber`.
 * - Los estados de antes pasan a los nuevos:
 *     solicitud: borrador → borrador · aprobada/enviada/recibida → autorizada · cancelada → anulada
 *     orden:     aprobada/enviada/borrador → emitida · recibida → cerrada · cancelada → anulada
 *     recepción (una orden ya recibida) → orden cerrada
 *   Lo recibido de cada renglón queda como recibido.
 * - Cada orden de pago que paga una factura de una OC queda atada también a la OC,
 *   y cada OC guarda lo pagado y si está pagada.
 *
 *   pnpm migrate:purchases          → sólo cuenta lo que haría
 *   pnpm migrate:purchases --apply  → lo hace
 *
 * Se puede correr las veces que haga falta: lo ya migrado no se vuelve a tocar.
 */
const uri = process.env.MONGODB_URI?.trim();
if (!uri) throw new Error("Falta MONGODB_URI");
const apply = process.argv.includes("--apply");

await mongoose.connect(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
const db = mongoose.connection;
const purchases = db.collection("purchases");
const payments = db.collection("payments");
const expenses = db.collection("expenses");
const counters = db.collection("counters");
const now = new Date();
const log = [];

const requestStatus = { borrador: "borrador", aprobada: "autorizada", enviada: "autorizada", recibida: "autorizada", cancelada: "anulada" };
const orderStatus = { borrador: "emitida", aprobada: "emitida", enviada: "emitida", recibida: "cerrada", cancelada: "anulada" };
const received = items => Array.isArray(items) ? items.map(line => ({ ...line, receivedQty: Number(line.quantity || 0) })) : items;

// 1. Solicitudes: número propio y estado nuevo.
const requests = await purchases.find({ stage: "solicitud", number: { $not: /^SC-\d+$/ } }).sort({ createdAt: 1 }).toArray();
const counter = await counters.findOne({ _id: "purchase_requests" });
let seq = Number(counter?.seq || 0);
for (const request of requests) {
  seq += 1;
  const set = { number: `SC-${seq}`, legacyNumber: request.number, status: requestStatus[request.status] || request.status };
  if (set.status === "autorizada" && !request.approval) set.approval = { at: request.updatedAt || now, automatic: true, reason: "Aprobada antes del circuito nuevo" };
  log.push(`${request.number} → ${set.number} (${request.status} → ${set.status})`);
  if (apply) await purchases.updateOne({ _id: request._id }, { $set: set });
}
if (apply && requests.length) await counters.updateOne({ _id: "purchase_requests" }, { $set: { seq } }, { upsert: true });

// 2. Órdenes y recepciones: estado nuevo y lo recibido.
const orders = await purchases.find({ stage: { $in: ["orden", "recepcion"] }, status: { $in: Object.keys(orderStatus) } }).toArray();
for (const order of orders) {
  const done = order.stage === "recepcion" || order.status === "recibida" || Boolean(order.stockedAt);
  const status = order.status === "cancelada" ? "anulada" : done ? "cerrada" : orderStatus[order.status];
  const set = { stage: "orden", status, receptionStatus: done ? "recibida" : "pendiente", ...(done ? { items: received(order.items), closedAt: order.receivedDate || order.updatedAt || now } : {}) };
  log.push(`${order.number}: ${order.stage}/${order.status} → orden/${status}`);
  if (apply) await purchases.updateOne({ _id: order._id }, { $set: set });
}

// 3. Las OP de facturas de una OC quedan atadas a la OC.
const linked = await expenses.find({ purchaseId: { $exists: true, $ne: null } }).project({ _id: 1, purchaseId: 1 }).toArray();
let tied = 0;
for (const expense of linked) {
  if (!apply) { tied += await payments.countDocuments({ expenseId: expense._id, purchaseId: { $exists: false } }); continue; }
  const result = await payments.updateMany({ expenseId: expense._id, purchaseId: { $exists: false } }, { $set: { purchaseId: expense.purchaseId } });
  tied += result.modifiedCount;
}

// 4. Lo pagado de cada OC.
let refreshed = 0;
if (apply) {
  for (const order of await purchases.find({ stage: "orden" }).project({ _id: 1, amountCents: 1 }).toArray()) {
    const rows = await payments.find({ purchaseId: order._id, status: { $nin: ["emitida", "anulada"] } }).project({ amountCents: 1 }).toArray();
    const paidCents = rows.reduce((total, row) => total + Number(row.amountCents || 0), 0);
    const total = Number(order.amountCents || 0);
    const paymentStatus = paidCents > 0 && paidCents >= total - 100 ? "pagada" : paidCents > 0 ? "parcial" : "pendiente";
    await purchases.updateOne({ _id: order._id }, { $set: { paidCents, paymentStatus } });
    refreshed++;
  }
}

for (const line of log) console.log(`- ${line}`);
console.log(`\n[compras] ${requests.length} solicitudes renumeradas, ${orders.length} órdenes con estado nuevo, ${tied} órdenes de pago atadas a su OC${apply ? `, ${refreshed} OC con lo pagado recalculado` : ""}`);
if (!apply) console.log("[compras] Modo prueba: no se tocó nada. Para hacerlo, --apply");
await mongoose.disconnect();
