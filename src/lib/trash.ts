import type { Types } from "mongoose";
import { Expense, Invoice, Quote, StockTrash, Work } from "./models";

export const TRASH_ENTITIES = ["stock", "works", "clients"] as const;
export type TrashEntity = (typeof TRASH_ENTITIES)[number];

export function isTrashEntity(value: unknown): value is TrashEntity {
  return TRASH_ENTITIES.includes(value as TrashEntity);
}

/** Filtro de una papelera. Los registros viejos no tienen `entity`: son del stock. */
export function trashOf(entity: TrashEntity) {
  return entity === "stock" ? { entity: { $in: ["stock", null] } } : { entity };
}

type Id = Types.ObjectId;
type TrashRow = { entity?: string; item?: { _id?: Id; quoteId?: Id; movements?: Array<{ expenseId?: Id }> } };

/**
 * Lo que no cuenta en los números porque está en la papelera (o se eliminó de
 * ella): las obras y clientes borrados, con sus ventas, facturas y gastos, y los
 * gastos que generaron las entregas de un material borrado.
 */
export async function excludedFromTotals() {
  const rows = await StockTrash.find({}, { entity: 1, "item._id": 1, "item.quoteId": 1, "item.movements.expenseId": 1 }).lean<TrashRow[]>();
  const works: Id[] = []; const clients: Id[] = []; const quotes: Id[] = []; const stockExpenses: Id[] = [];
  for (const row of rows) {
    const entity = row.entity || "stock";
    if (entity === "works" && row.item?._id) { works.push(row.item._id); if (row.item.quoteId) quotes.push(row.item.quoteId); }
    if (entity === "clients" && row.item?._id) clients.push(row.item._id);
    if (entity === "stock") for (const movement of row.item?.movements || []) if (movement.expenseId) stockExpenses.push(movement.expenseId);
  }
  // Las obras de un cliente borrado tampoco cuentan, aunque sigan en su lista.
  if (clients.length) {
    const [clientWorks, clientQuotes] = await Promise.all([
      Work.find({ clientId: { $in: clients } }, { _id: 1 }).lean<Array<{ _id: Id }>>(),
      Quote.find({ clientId: { $in: clients } }, { _id: 1 }).lean<Array<{ _id: Id }>>(),
    ]);
    works.push(...clientWorks.map(work => work._id)); quotes.push(...clientQuotes.map(quote => quote._id));
  }
  const [expenses, invoices] = await Promise.all([
    stockExpenses.length || works.length ? Expense.distinct("_id", { $or: [{ _id: { $in: stockExpenses } }, { workId: { $in: works } }] }) as Promise<Id[]> : [],
    works.length || clients.length ? Invoice.distinct("_id", { $or: [{ workId: { $in: works } }, { clientId: { $in: clients } }] }) as Promise<Id[]> : [],
  ]);
  return { works, clients, quotes, expenses, invoices };
}
