import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { Client, Quote, Work, Invoice, Collection, Expense, Payment, Check, Task } from "@/lib/models";
import { apiError } from "@/lib/api";
import { comparisonPercent, marginPercent, monthKeys, parseDashboardRange, rangeMonths } from "@/lib/dashboard";

type TotalRow = { total?: number };
type MonthlyRow = { _id: string; value: number };

function total(rows: TotalRow[]) {
  return Number(rows[0]?.total || 0);
}

function monthlyMap(rows: MonthlyRow[]) {
  return new Map(rows.map(row => [row._id, Number(row.value || 0)]));
}

export async function GET(request: Request) {
  try {
    await requireSession();
    await connectDB();

    const range = parseDashboardRange(new URL(request.url).searchParams.get("range"));
    if (!range) return Response.json({ error: "Período inválido" }, { status: 400 });

    const months = rangeMonths(range);
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    const previousFrom = new Date(from.getFullYear(), from.getMonth() - months, 1);
    const previousTo = new Date(from.getTime() - 1);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueSoonLimit = new Date(today.getTime() + 30 * 86400000);
    const timezone = "America/Argentina/Buenos_Aires";

    const [
      activeClients, openQuotes, activeWorks, workCosts,
      salesRows, previousSalesRows, billedRows, previousBilledRows,
      expenseRows, previousExpenseRows, collectionRows, paymentRows,
      receivableRows, checksDue, pendingTasks,
      monthlySalesRows, monthlyInvoiceRows, monthlyCollectionRows, monthlyExpenseRows,
    ] = await Promise.all([
      Client.countDocuments({ active: true }),
      Quote.countDocuments({ status: { $in: ["enviada", "seguimiento"] } }),
      Work.find({ status: "en_curso" }).select("name code progress budgetCents status endDate updatedAt").sort({ updatedAt: -1 }).limit(4).lean(),
      Expense.aggregate([
        { $match: { workId: { $ne: null }, status: { $ne: "anulado" } } },
        { $group: { _id: "$workId", total: { $sum: "$amountCents" } } },
      ]),
      Quote.aggregate([
        { $match: { status: "aprobada", updatedAt: { $gte: from, $lte: now } } },
        { $group: { _id: null, total: { $sum: "$amountCents" } } },
      ]),
      Quote.aggregate([
        { $match: { status: "aprobada", updatedAt: { $gte: previousFrom, $lte: previousTo } } },
        { $group: { _id: null, total: { $sum: "$amountCents" } } },
      ]),
      Invoice.aggregate([
        { $match: { status: { $ne: "anulada" }, issueDate: { $gte: from, $lte: now } } },
        { $group: { _id: null, total: { $sum: "$amountCents" } } },
      ]),
      Invoice.aggregate([
        { $match: { status: { $ne: "anulada" }, issueDate: { $gte: previousFrom, $lte: previousTo } } },
        { $group: { _id: null, total: { $sum: "$amountCents" } } },
      ]),
      Expense.aggregate([
        { $match: { status: { $ne: "anulado" }, issueDate: { $gte: from, $lte: now } } },
        { $group: { _id: null, total: { $sum: "$amountCents" } } },
      ]),
      Expense.aggregate([
        { $match: { status: { $ne: "anulado" }, issueDate: { $gte: previousFrom, $lte: previousTo } } },
        { $group: { _id: null, total: { $sum: "$amountCents" } } },
      ]),
      Collection.aggregate([
        { $match: { date: { $gte: from, $lte: now } } },
        { $group: { _id: null, total: { $sum: "$amountCents" } } },
      ]),
      Payment.aggregate([
        { $match: { date: { $gte: from, $lte: now } } },
        { $group: { _id: null, total: { $sum: "$amountCents" } } },
      ]),
      Invoice.aggregate([
        { $match: { status: { $ne: "anulada" } } },
        { $project: { dueDate: 1, balance: { $max: [{ $subtract: ["$amountCents", "$collectedCents"] }, 0] } } },
        { $match: { balance: { $gt: 0 } } },
        { $group: {
          _id: null,
          total: { $sum: "$balance" },
          overdue: { $sum: { $cond: [{ $and: [{ $ne: ["$dueDate", null] }, { $lt: ["$dueDate", today] }] }, "$balance", 0] } },
          dueSoon: { $sum: { $cond: [{ $and: [{ $gte: ["$dueDate", today] }, { $lte: ["$dueDate", dueSoonLimit] }] }, "$balance", 0] } },
          future: { $sum: { $cond: [{ $or: [{ $eq: ["$dueDate", null] }, { $gt: ["$dueDate", dueSoonLimit] }] }, "$balance", 0] } },
        } },
      ]),
      Check.countDocuments({ dueDate: { $gte: today, $lte: new Date(today.getTime() + 7 * 86400000) }, status: { $in: ["cartera", "emitido"] } }),
      Task.countDocuments({ status: { $ne: "completada" } }),
      Quote.aggregate([
        { $match: { status: "aprobada", updatedAt: { $gte: from, $lte: now } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$updatedAt", timezone } }, value: { $sum: "$amountCents" } } },
      ]),
      Invoice.aggregate([
        { $match: { status: { $ne: "anulada" }, issueDate: { $gte: from, $lte: now } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$issueDate", timezone } }, value: { $sum: "$amountCents" } } },
      ]),
      Collection.aggregate([
        { $match: { date: { $gte: from, $lte: now } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$date", timezone } }, value: { $sum: "$amountCents" } } },
      ]),
      Expense.aggregate([
        { $match: { status: { $ne: "anulado" }, issueDate: { $gte: from, $lte: now } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$issueDate", timezone } }, value: { $sum: "$amountCents" } } },
      ]),
    ]);

    const salesCents = total(salesRows);
    const billedCents = total(billedRows);
    const expenseCents = total(expenseRows);
    const previousMarginCents = total(previousBilledRows) - total(previousExpenseRows);
    const netMarginCents = billedCents - expenseCents;
    const collectedCents = total(collectionRows);
    const paidCents = total(paymentRows);
    const receivables = receivableRows[0] || { total: 0, overdue: 0, dueSoon: 0, future: 0 };
    const costsByWork = new Map(workCosts.map(row => [String(row._id), Number(row.total || 0)]));
    const progressTotal = activeWorks.reduce((sum, work) => sum + Number(work.progress || 0), 0);

    const salesByMonth = monthlyMap(monthlySalesRows);
    const invoicesByMonth = monthlyMap(monthlyInvoiceRows);
    const collectionsByMonth = monthlyMap(monthlyCollectionRows);
    const expensesByMonth = monthlyMap(monthlyExpenseRows);
    const monthlySeries = monthKeys(from, months).map(period => ({
      period,
      salesCents: salesByMonth.get(period) || 0,
      invoicedCents: invoicesByMonth.get(period) || 0,
      collectedCents: collectionsByMonth.get(period) || 0,
      expenseCents: expensesByMonth.get(period) || 0,
    }));

    return Response.json({
      period: { range, months, from, to: now, generatedAt: now },
      kpis: {
        activeWorks: activeWorks.length,
        averageProgress: activeWorks.length ? Math.round(progressTotal / activeWorks.length) : 0,
        salesCents,
        invoicedCents: billedCents,
        receivableCents: Number(receivables.total || 0),
        netMarginCents,
        netMarginPercent: marginPercent(billedCents, expenseCents),
      },
      comparison: {
        salesPercent: comparisonPercent(salesCents, total(previousSalesRows)),
        invoicedPercent: comparisonPercent(billedCents, total(previousBilledRows)),
        netMarginPercent: comparisonPercent(netMarginCents, previousMarginCents),
      },
      monthlySeries,
      activeWorks: activeWorks.map(work => ({
        ...work,
        costCents: costsByWork.get(String(work._id)) || 0,
      })),
      receivables: {
        totalCents: Number(receivables.total || 0),
        overdueCents: Number(receivables.overdue || 0),
        dueSoonCents: Number(receivables.dueSoon || 0),
        futureCents: Number(receivables.future || 0),
      },
      cashflow: { incomeCents: collectedCents, expenseCents: paidCents, balanceCents: collectedCents - paidCents },
      alerts: { pendingTasks, checksDue, activeClients, openQuotes },
    });
  } catch (error) {
    return apiError(error);
  }
}
