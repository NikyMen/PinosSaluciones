import { isValidObjectId } from "mongoose";
import { ROLES, type Role } from "./constants";
import { User } from "./models";
import type { AuthorizedSession } from "./auth";

/**
 * Quien ve que tarea.
 *
 * Gerencia ve todo y filtra por area o por persona cuando quiere. El resto ve
 * solo lo de su area y lo que lleva su nombre. El recorte se hace en el
 * servidor, asi vale igual para el listado, el contador de la barra y la
 * exportacion a Excel.
 */
export function taskScope(session: AuthorizedSession, params: URLSearchParams) {
  const scope = params.get("scope") || "";
  const mine = { assigneeId: session.userId };
  const area = { assigneeRole: session.role };
  if (scope === "mine") return mine;
  if (scope === "area") return area;
  if (session.role !== "gerencia") return { $or: [mine, area] };

  const conditions: Record<string, unknown>[] = [];
  const role = params.get("assigneeRole") || "";
  const assigneeId = params.get("assigneeId") || "";
  if (ROLES.includes(role as Role)) conditions.push({ assigneeRole: role });
  if (isValidObjectId(assigneeId)) conditions.push({ assigneeId });
  return conditions.length ? { $and: conditions } : {};
}

/** La misma regla, pero sobre una tarea ya leida. */
export function canSeeTask(session: AuthorizedSession, task: { assigneeRole?: unknown; assigneeId?: unknown }) {
  if (session.role === "gerencia") return true;
  return String(task.assigneeId || "") === session.userId || String(task.assigneeRole || "") === session.role;
}

/**
 * Completa la asignacion antes de guardar: copia el nombre de la persona y, si
 * no se eligio area, pone la de la persona asignada o la de quien la crea. Sin
 * area ni persona la tarea nace invisible para todos menos gerencia.
 */
export async function resolveTaskAssignee(session: AuthorizedSession, data: Record<string, unknown>, fallbackRole = true) {
  // Al editar solo el estado no viene la asignacion: no hay nada que tocar.
  if (!("assigneeId" in data) && !fallbackRole) return;
  const assigneeId = String(data.assigneeId || "");
  if (isValidObjectId(assigneeId)) {
    const user = await User.findById(assigneeId).select("name role").lean() as { name?: string; role?: Role } | null;
    data.assigneeName = user?.name || "";
    if (!data.assigneeRole && user?.role) data.assigneeRole = user.role;
  } else {
    data.assigneeId = undefined;
    data.assigneeName = "";
  }
  if (!data.assigneeRole && fallbackRole) data.assigneeRole = session.role;
}
