import { HttpError } from "./api";
import { Quote, Work, WorkCategory } from "./models";

const defaults = [
  ["altura", "Trabajo en altura"], ["albanileria", "Albañilería"], ["interior", "Pintura interior"],
  ["exterior", "Pintura exterior"], ["impermeabilizacion", "Impermeabilización"], ["poliuretano", "Poliuretano/Poliurea"],
];

export async function listWorkCategories() {
  const existing = await WorkCategory.find().sort({ name: 1 }).lean();
  if (existing.length) return existing;
  await WorkCategory.bulkWrite(defaults.map(([key, name]) => ({
    updateOne: { filter: { key }, update: { $setOnInsert: { key, name, allowed: true } }, upsert: true },
  })));
  return WorkCategory.find().sort({ name: 1 }).lean();
}

export async function checkQuoteCategory(value: unknown, prior?: unknown) {
  if (!value) throw new HttpError("Elegí el rubro de la cotización");
  if (String(value) === String(prior ?? "")) return;
  if (!await WorkCategory.exists({ _id: value, allowed: true })) throw new HttpError("Elegí un rubro activo");
}

export async function projectCategory(project: Record<string, unknown>) {
  const work = project.workId ? await Work.findById(project.workId).select("quoteId workCategoryId").lean<{ quoteId?: unknown; workCategoryId?: unknown }>() : null;
  const quoteId = project.quoteId || work?.quoteId;
  const quote = quoteId ? await Quote.findById(quoteId).select("workCategoryId").lean<{ workCategoryId?: unknown }>() : null;
  return { workCategoryId: quote?.workCategoryId || work?.workCategoryId || null };
}
