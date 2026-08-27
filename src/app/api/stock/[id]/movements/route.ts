import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { StockItem, Purchase, Expense, Work } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { notify } from "@/lib/notifications";
import { money } from "@/lib/format";

/**
 * Un movimiento de stock es lo único que cambia la cantidad de un material.
 *
 * - `ingreso` (una compra): suma cantidad, recalcula el costo promedio ponderado
 *   y deja la orden de compra recibida con el proveedor. Todavía no es costo de
 *   ninguna obra: el material está en el depósito.
 * - `egreso` (asignación a obra): descuenta cantidad y recién ahí carga el gasto
 *   contra la obra, valorizado al costo promedio. Así el costo aparece una sola
 *   vez y en la obra que de verdad consumió el material.
 * - `ajuste`: corrige la cantidad tras un conteo físico, sin plata de por medio.
 */
const schema = z.object({
  kind: z.enum(["ingreso", "egreso", "ajuste"]),
  quantity: z.coerce.number().positive("La cantidad tiene que ser mayor a cero"),
  unitCostCents: z.coerce.number().int().min(0).default(0),
  supplierId: z.string().optional(),
  workId: z.string().optional(),
  reference: z.string().trim().optional().default(""),
  note: z.string().trim().optional().default(""),
  date: z.coerce.date().optional(),
});

export async function POST(request: Request, context: RouteContext<"/api/stock/[id]/movements">) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "stock")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    const { kind, quantity, unitCostCents, reference, note } = parsed.data;
    const supplierId = isValidObjectId(parsed.data.supplierId || "") ? parsed.data.supplierId : undefined;
    const workId = isValidObjectId(parsed.data.workId || "") ? parsed.data.workId : undefined;
    const date = parsed.data.date ?? new Date();

    await connectDB();
    const item = await StockItem.findById(id);
    if (!item) return Response.json({ error: "Material no encontrado" }, { status: 404 });
    const before = item.toObject();

    if (kind === "egreso" && !workId) return Response.json({ error: "Elegí a qué obra se entrega el material" }, { status: 400 });
    if (kind === "egreso" && quantity > item.quantity) {
      return Response.json({ error: `Solo hay ${item.quantity} ${item.unit} en stock` }, { status: 409 });
    }

    const movement: Record<string, unknown> = { kind, quantity, reference, note, date, supplierId, workId, userId: session.userId, userName: session.name };

    if (kind === "ingreso") {
      const totalCents = Math.round(quantity * unitCostCents);
      // Promedio ponderado: mezcla lo que ya había con lo que entra al precio nuevo.
      const newQuantity = item.quantity + quantity;
      item.avgCostCents = newQuantity > 0 ? Math.round((item.valueCents + totalCents) / newQuantity) : 0;
      item.quantity = newQuantity;
      const purchase = await Purchase.create({
        number: reference || `STK-${Date.now().toString(36).toUpperCase()}`,
        supplierId, description: `${quantity} ${item.unit} de ${item.name}`,
        amountCents: totalCents, stage: "recepcion", status: "recibida",
        requestedDate: date, receivedDate: date, receiptNotes: note,
      });
      movement.unitCostCents = unitCostCents;
      movement.totalCents = totalCents;
      movement.purchaseId = purchase._id;
    }

    if (kind === "egreso") {
      const totalCents = Math.round(quantity * item.avgCostCents);
      item.quantity -= quantity;
      const work = await Work.findById(workId).select("code name").lean() as { code?: string; name?: string } | null;
      const expense = await Expense.create({
        supplierId, workId, description: `${quantity} ${item.unit} de ${item.name} entregados en obra`,
        category: "materiales", amountCents: totalCents, issueDate: date, status: "pendiente",
        number: reference || undefined,
      });
      movement.unitCostCents = item.avgCostCents;
      movement.totalCents = totalCents;
      movement.expenseId = expense._id;
      movement.note = note || `Obra ${work?.code || ""} ${work?.name || ""}`.trim();
    }

    if (kind === "ajuste") {
      // El ajuste fija la cantidad contada, no la suma.
      movement.quantity = quantity - item.quantity;
      item.quantity = quantity;
    }

    item.valueCents = Math.max(0, Math.round(item.quantity * item.avgCostCents));
    item.movements.push(movement);
    await item.save();

    // El aviso de stock mínimo sale una sola vez por caída: la clave incluye el
    // momento en que cruzó el umbral, así no repite en cada salida.
    if (item.minQuantity > 0 && item.quantity <= item.minQuantity) {
      await notify({
        title: `Stock bajo: ${item.name}`,
        body: `Quedan ${item.quantity} ${item.unit} y el mínimo es ${item.minQuantity}. Valorizado en ${money(item.valueCents)}.`,
        kind: "stock", href: "/app/stock", roles: ["compras"],
        dedupeKey: `stock-low-${item._id}-${item.quantity}`,
      });
    }

    await audit(session, `stock_${kind}`, "stock", item._id, before, item.toObject(), request.headers.get("x-forwarded-for") || undefined);
    return Response.json(item, { status: 201 });
  } catch (error) { return apiError(error); }
}
