import type { Types } from "mongoose";
import { Asset, Expense, Notification, Task } from "./models";
import { notify } from "./notifications";
import { meterLabels, nextPlan, planState, type AssetPlan } from "./assets";
import type { Session } from "./auth";

/*
 * El mantenimiento de un bien de uso: registrar un service (y, si se quiere,
 * cargar su costo como gasto), programar el próximo y cerrar lo que ya se hizo.
 * Los avisos por fecha los deja scripts/worker.mjs; los que dependen del uso
 * (km, horas) salen acá, que es donde cambia la lectura.
 */

export class AssetError extends Error {}

type PlanDoc = AssetPlan & { _id: Types.ObjectId; set: (patch: Record<string, unknown>) => void };
type AssetDoc = {
  _id: Types.ObjectId; name: string; identifier?: string; meterUnit?: string; currentReading?: number; readingDate?: Date; status?: string;
  maintenance: { push: (...items: unknown[]) => number; at: (index: number) => { _id: Types.ObjectId } | undefined; length: number };
  plans: PlanDoc[] & { push: (...items: unknown[]) => number; id: (id: unknown) => PlanDoc | null };
  set: (patch: Record<string, unknown>) => void; save: () => Promise<unknown>; toObject: () => Record<string, unknown>;
};

export type NextPlanInput = { title: string; dueDate?: Date; dueReading?: number; intervalMonths?: number; intervalReading?: number; notes?: string };
export type AssetAction =
  | { action: "service"; date: Date; kind: "service" | "preventivo" | "reparacion" | "inspeccion" | "otro"; description: string; costCents: number; reading?: number; provider?: string; notes?: string; createExpense?: boolean; planId?: string; next?: NextPlanInput }
  | ({ action: "plan" } & NextPlanInput)
  | { action: "cancel_plan"; planId: string }
  | { action: "reading"; reading: number; date?: Date };

const label = (asset: Pick<AssetDoc, "name" | "identifier">) => asset.identifier ? `${asset.name} (${asset.identifier})` : asset.name;

/** El próximo pendiente, copiado al bien para listarlo y ordenarlo. */
export function refreshNextDue(asset: AssetDoc) {
  const next = nextPlan(asset.plans as AssetPlan[]);
  asset.set({ nextDueDate: next?.dueDate || undefined, nextDueTitle: next?.title || undefined, nextDueReading: next?.dueReading ?? undefined });
}

/** Hecho o cancelado: la tarea y el aviso de ese mantenimiento ya no tienen sentido. */
async function closeReminders(planId: Types.ObjectId) {
  await Promise.all([
    Task.updateMany({ relatedType: "asset_plans", relatedId: planId, status: { $ne: "completada" } }, { $set: { status: "completada" } }),
    Notification.updateMany({ dedupeKey: `asset-plan-${planId}` }, { $set: { status: "hecha" } }),
  ]);
}

/** El aviso y la tarea de un mantenimiento que ya toca. Una sola vez por mantenimiento. */
export async function remindPlan(asset: Pick<AssetDoc, "_id" | "name" | "identifier" | "meterUnit">, plan: AssetPlan & { _id: unknown }, why: string) {
  const title = `Mantenimiento: ${plan.title} — ${label(asset)}`;
  await Task.updateOne(
    { relatedType: "asset_plans", relatedId: plan._id, status: { $ne: "completada" } },
    { $setOnInsert: { title, description: `${why}. Registralo en Bienes de uso cuando esté hecho.`, type: "vencimiento", status: "pendiente", assigneeRole: "compras", relatedType: "asset_plans", relatedId: plan._id, dueDate: plan.dueDate || new Date() } },
    { upsert: true },
  );
  await notify({ title, body: why, kind: "vencimiento", href: "/app/assets", roles: ["compras", "administracion"], dedupeKey: `asset-plan-${plan._id}` });
}

/** Con la lectura nueva, lo que vence por uso y ya está cerca avisa en el momento. */
async function remindByReading(asset: AssetDoc) {
  if (!asset.meterUnit || asset.meterUnit === "ninguno" || asset.currentReading == null) return;
  const unit = meterLabels[asset.meterUnit] || "";
  for (const plan of asset.plans) {
    if ((plan.status || "pendiente") !== "pendiente" || plan.dueReading == null) continue;
    const state = planState(plan, asset);
    if (state.readingLeft === null || state.state === "al_dia") continue;
    const number = new Intl.NumberFormat("es-AR").format(plan.dueReading);
    await remindPlan(asset, plan, state.readingLeft <= 0 ? `Tocaba a los ${number} ${unit} y ya tiene ${new Intl.NumberFormat("es-AR").format(asset.currentReading)} ${unit}` : `Toca a los ${number} ${unit}: faltan ${new Intl.NumberFormat("es-AR").format(state.readingLeft)} ${unit}`);
  }
}

function addPlan(asset: AssetDoc, input: NextPlanInput, session: Session) {
  if (!input.dueDate && input.dueReading == null) throw new AssetError("Poné cuándo toca: una fecha, una lectura de uso o las dos");
  if (input.dueReading != null && (!asset.meterUnit || asset.meterUnit === "ninguno")) throw new AssetError("Este bien no mide el uso: programalo por fecha o cargale si va por km u horas");
  asset.plans.push({ title: input.title, dueDate: input.dueDate, dueReading: input.dueReading, intervalMonths: input.intervalMonths, intervalReading: input.intervalReading, notes: input.notes, status: "pendiente", createdByName: session.name });
}

function setReading(asset: AssetDoc, reading: number | undefined, when: Date) {
  if (reading == null) return;
  // Una lectura vieja (un service de hace meses que se carga tarde) no pisa una más nueva.
  if (asset.currentReading != null && reading < asset.currentReading && asset.readingDate && when < asset.readingDate) return;
  asset.set({ currentReading: reading, readingDate: when });
}

export async function applyAssetAction(assetId: string, input: AssetAction, session: Session) {
  const asset = await Asset.findById(assetId) as unknown as AssetDoc | null;
  if (!asset) throw new AssetError("Bien no encontrado");
  const result: { expenseId?: string } = {};

  if (input.action === "service") {
    const plan = input.planId ? asset.plans.id(input.planId) : null;
    if (input.planId && !plan) throw new AssetError("Ese mantenimiento programado ya no existe");
    let expenseId: Types.ObjectId | undefined;
    if (input.createExpense && input.costCents > 0) {
      const expense = await Expense.create({
        description: `${input.description} — ${label(asset)}${input.provider ? ` (${input.provider})` : ""}`,
        category: "servicios", amountCents: input.costCents, issueDate: input.date, status: "pendiente",
      });
      expenseId = expense._id;
      result.expenseId = String(expense._id);
    }
    asset.maintenance.push({
      date: input.date, kind: input.kind, description: input.description, costCents: input.costCents, reading: input.reading,
      provider: input.provider, notes: input.notes, expenseId, planId: plan?._id, userId: session.userId, userName: session.name,
    });
    setReading(asset, input.reading, input.date);
    if (plan) {
      plan.set({ status: "hecho", doneAt: input.date, doneByName: session.name, maintenanceId: asset.maintenance.at(-1)?._id });
      await closeReminders(plan._id);
    }
    if (input.next) addPlan(asset, input.next, session);
    // Si estaba en el taller y se registra el arreglo, vuelve a estar en uso.
    if (asset.status === "en_reparacion" && input.kind === "reparacion") asset.set({ status: "activo" });
  }

  if (input.action === "plan") addPlan(asset, input, session);

  if (input.action === "cancel_plan") {
    const plan = asset.plans.id(input.planId);
    if (!plan) throw new AssetError("Ese mantenimiento programado ya no existe");
    plan.set({ status: "cancelado", doneAt: new Date(), doneByName: session.name });
    await closeReminders(plan._id);
  }

  if (input.action === "reading") {
    if (!asset.meterUnit || asset.meterUnit === "ninguno") throw new AssetError("Este bien no mide el uso");
    setReading(asset, input.reading, input.date || new Date());
  }

  refreshNextDue(asset);
  await asset.save();
  await remindByReading(asset);
  return { asset: asset.toObject(), ...result };
}

/** Después de editar el bien desde el formulario: la lectura pudo cambiar. */
export async function refreshAssetSchedule(assetId: string) {
  const asset = await Asset.findById(assetId) as unknown as AssetDoc | null;
  if (!asset) return;
  refreshNextDue(asset);
  await asset.save();
  await remindByReading(asset);
}

