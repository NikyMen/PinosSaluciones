import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { Client, Quote, Work, Invoice, Collection, Expense, Payment, Check, Task } from "@/lib/models";
import { apiError } from "@/lib/api";

export async function GET() {
  try {
    await requireSession(); await connectDB();
    const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [clients, openQuotes, activeWorks, invoiceAgg, collectionAgg, expenseAgg, paymentAgg, checksDue, pendingTasks, works] = await Promise.all([
      Client.countDocuments({ active: true }),
      Quote.countDocuments({ status: { $in: ["enviada", "seguimiento"] } }),
      Work.countDocuments({ status: { $in: ["planificada", "en_curso", "pausada"] } }),
      Invoice.aggregate([{ $match: { status: { $ne: "anulada" } } }, { $group: { _id: null, total: { $sum: "$amountCents" }, collected: { $sum: "$collectedCents" } } }]),
      Collection.aggregate([{ $match: { date: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: "$amountCents" } } }]),
      Expense.aggregate([{ $match: { status: { $ne: "anulado" } } }, { $group: { _id: null, total: { $sum: "$amountCents" }, paid: { $sum: "$paidCents" } } }]),
      Payment.aggregate([{ $match: { date: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: "$amountCents" } } }]),
      Check.countDocuments({ dueDate: { $lte: new Date(now.getTime() + 7 * 86400000) }, status: { $in: ["cartera", "emitido"] } }),
      Task.countDocuments({ status: { $ne: "completada" } }),
      Work.find({ status: { $ne: "cancelada" } }).select("name progress budgetCents status").sort({ updatedAt: -1 }).limit(5).lean(),
    ]);
    const invoiced = invoiceAgg[0]?.total || 0; const collected = invoiceAgg[0]?.collected || 0;
    const committed = expenseAgg[0]?.total || 0; const paid = expenseAgg[0]?.paid || 0;
    return Response.json({
      cards: { clients, openQuotes, activeWorks, receivableCents: invoiced - collected, payableCents: committed - paid, monthIncomeCents: collectionAgg[0]?.total || 0, monthExpenseCents: paymentAgg[0]?.total || 0, checksDue, pendingTasks },
      works,
    });
  } catch (error) { return apiError(error); }
}
