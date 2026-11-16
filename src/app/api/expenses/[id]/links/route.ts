import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { apiError, HttpError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { canRead, canWrite } from "@/lib/permissions";
import { associateExpense, expenseLinks, findExpense } from "@/lib/expense-links";

const schema = z.object({ kind: z.enum(["purchase", "quote"]), id: z.string().regex(/^[a-f\d]{24}$/i) });

export async function GET(_request: Request, context: RouteContext<"/api/expenses/[id]/links">) {
  try {
    const session = await requireSession();
    if (!canRead(session, "expenses")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    await connectDB();
    return Response.json(await expenseLinks(await findExpense(id), session));
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: RouteContext<"/api/expenses/[id]/links">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "expenses")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const input = schema.safeParse(await request.json());
    if (!input.success) throw new HttpError("Elegí una orden de compra o una cotización");
    await connectDB();
    const before = await findExpense(id);
    const after = await associateExpense(before, input.data.kind, input.data.id);
    await audit(session, "associate", "expenses", id, before, after);
    return Response.json(await expenseLinks(after, session));
  } catch (error) { return apiError(error); }
}
