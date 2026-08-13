import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { CashMovement, Collection, Payment, Invoice, Expense, Work } from "@/lib/models";
import { apiError } from "@/lib/api";

export async function GET(request: Request) {
  try {
    await requireSession(); await connectDB();
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : new Date(new Date().getFullYear(), 0, 1);
    const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")! + "T23:59:59") : new Date();
    const [income, outcomes, cashIncome, cashOutcomes, invoices, expenses, works] = await Promise.all([
      Collection.aggregate([{ $match: { date: { $gte: from, $lte: to } } }, { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$date" } }, value: { $sum: "$amountCents" } } }, { $sort: { _id: 1 } }]),
      Payment.aggregate([{ $match: { date: { $gte: from, $lte: to } } }, { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$date" } }, value: { $sum: "$amountCents" } } }, { $sort: { _id: 1 } }]),
      CashMovement.aggregate([{ $match: { date: { $gte: from, $lte: to }, direction: "ingreso" } }, { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$date" } }, value: { $sum: "$amountCents" } } }]),
      CashMovement.aggregate([{ $match: { date: { $gte: from, $lte: to }, direction: "egreso" } }, { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$date" } }, value: { $sum: "$amountCents" } } }]),
      Invoice.aggregate([{ $match: { issueDate: { $gte: from, $lte: to }, status: { $ne: "anulada" } } }, { $group: { _id: "$workId", revenue: { $sum: "$amountCents" } } }]),
      Expense.aggregate([{ $match: { issueDate: { $gte: from, $lte: to }, status: { $ne: "anulado" } } }, { $group: { _id: "$workId", cost: { $sum: "$amountCents" } } }]),
      Work.find().select("name budgetCents").lean(),
    ]);
    const costs = new Map(expenses.map(x => [String(x._id), x.cost]));
    const revenues = new Map(invoices.map(x => [String(x._id), x.revenue]));
    const profitability = works.map(work => { const revenue = revenues.get(String(work._id)) || 0; const cost = costs.get(String(work._id)) || 0; return { id: work._id, name: work.name, budgetCents: work.budgetCents, revenueCents: revenue, costCents: cost, marginCents: revenue - cost }; }).filter(x => x.revenueCents || x.costCents);
    const periods = [...new Set([...income.map(x => x._id), ...outcomes.map(x => x._id), ...cashIncome.map(x => x._id), ...cashOutcomes.map(x => x._id)])].sort();
    const cashflow = periods.map(period => ({ period, incomeCents: (income.find(x => x._id === period)?.value || 0) + (cashIncome.find(x => x._id === period)?.value || 0), outcomeCents: (outcomes.find(x => x._id === period)?.value || 0) + (cashOutcomes.find(x => x._id === period)?.value || 0) }));
    return Response.json({ cashflow, profitability });
  } catch (error) { return apiError(error); }
}
