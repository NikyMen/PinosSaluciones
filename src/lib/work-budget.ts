import { Quote } from "./models";
import { quoteNetCents, workNetBudgetCents } from "./net-amounts";

type WorkLike = { budgetNetCents?: number | null; budgetCents?: number; quoteId?: unknown };

/**
 * El presupuesto neto de una obra. Las obras de antes no lo tienen guardado: si
 * su presupuesto es el de la cotización, sale del neto de la cotización (su
 * cascada); si no, es el presupuesto sin el IVA.
 */
export async function resolveWorkNetBudget(work: WorkLike) {
  if (typeof work.budgetNetCents === "number") return work.budgetNetCents;
  if (work.quoteId) {
    const quote = await Quote.findById(work.quoteId).select("netCents amountCents items overheads cascade").lean<Parameters<typeof quoteNetCents>[0]>();
    if (quote && Number(quote.amountCents || 0) === Number(work.budgetCents || 0)) return quoteNetCents(quote);
  }
  return workNetBudgetCents(work);
}
