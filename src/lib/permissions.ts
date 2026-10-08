import { entities, USER_ACTIONS, viewSections, type Entity, type Role, type UserAction, type ViewSection } from "./constants";

/** `seen`: las secciones que existían cuando se guardaron estos permisos. `actions`: lo que se da por persona (autorizar compras). */
export type UserPermissions = { view: ViewSection[]; edit: Entity[]; seen?: ViewSection[]; actions?: UserAction[] };

/*
 * Secciones que se agregaron después de que se guardaron los permisos de la
 * gente. Quien tiene permisos guardados de antes no las tiene en su lista: se le
 * dan con lo que corresponde a su rol hasta que se editen sus permisos.
 */
const ADDED_LATER: ViewSection[] = ["assets", "accounts", "accounting", "cashAccounts"];
export type PermissionSubject = Role | { role: Role; permissions?: Partial<UserPermissions> };

const writeAccess: Record<Entity, Role[]> = {
  clients: ["gerencia", "ventas", "administracion"],
  quotes: ["gerencia", "ventas"],
  works: ["gerencia", "arquitecto", "auxiliar"],
  workers: ["gerencia", "arquitecto", "administracion"],
  suppliers: ["gerencia", "compras", "administracion"],
  stock: ["gerencia", "compras", "administracion"],
  purchases: ["gerencia", "compras", "administracion"],
  expenses: ["gerencia", "compras", "administracion"],
  invoices: ["gerencia", "administracion"],
  collections: ["gerencia", "administracion"],
  payments: ["gerencia", "administracion", "compras"],
  checks: ["gerencia", "administracion"],
  cash: ["gerencia", "administracion"],
  tasks: ["gerencia", "arquitecto", "auxiliar", "administracion", "compras", "ventas"],
  assets: ["gerencia", "compras", "administracion"],
  // El catálogo de cuentas lo mantienen administración y el contador: el resto lo elige, no lo escribe.
  accounts: ["gerencia", "administracion", "contador"],
  // El maestro de cajas y bancos lo mantienen Gerencia y Administración (Tesorería); el saldo inicial, sólo Gerencia.
  cashAccounts: ["gerencia", "administracion"],
};

/*
 * Lo que sólo puede hacer un rol, aunque a la persona se le haya dado permiso
 * de editar la sección: las órdenes de pago las emite Tesorería (Administración)
 * o Gerencia. Los permisos guardados de antes le daban OP a Compras.
 */
const roleLocked: Partial<Record<Entity, Role[]>> = {
  payments: ["gerencia", "administracion"],
};

export function defaultPermissionsForRole(role: Role): UserPermissions {
  return {
    view: [...viewSections],
    edit: entities.filter(entity => writeAccess[entity].includes(role)),
    seen: [...viewSections],
    actions: role === "gerencia" ? ["approvePurchases"] : [],
  };
}

export function normalizePermissions(role: Role, permissions?: Partial<UserPermissions> | null): UserPermissions {
  if (!permissions || !Array.isArray(permissions.view) || !Array.isArray(permissions.edit)) return defaultPermissionsForRole(role);
  const seen = Array.isArray(permissions.seen) ? permissions.seen : viewSections.filter(section => !ADDED_LATER.includes(section));
  // Lo que apareció después de guardarlos: como para cualquiera de su rol.
  const fresh = viewSections.filter(section => !seen.includes(section));
  const defaults = defaultPermissionsForRole(role);
  const view = [...new Set([...permissions.view, ...fresh.filter(section => defaults.view.includes(section))])].filter((section): section is ViewSection => viewSections.includes(section as ViewSection));
  const edit = [...new Set([...permissions.edit, ...fresh.filter(section => defaults.edit.includes(section as Entity))])].filter((entity): entity is Entity => entities.includes(entity as Entity) && view.includes(entity as ViewSection));
  const actions = (Array.isArray(permissions.actions) ? permissions.actions : []).filter((action): action is UserAction => USER_ACTIONS.includes(action as UserAction));
  return { view, edit, seen: [...viewSections], actions: role === "gerencia" ? [...new Set<UserAction>([...actions, "approvePurchases"])] : actions };
}

function resolved(subject: PermissionSubject) {
  return typeof subject === "string" ? defaultPermissionsForRole(subject) : normalizePermissions(subject.role, subject.permissions);
}

export function canViewSection(subject: PermissionSubject, section: ViewSection) { return resolved(subject).view.includes(section); }
export function canRead(subject: PermissionSubject, entity: Entity) { return canViewSection(subject, entity); }
export function canWrite(subject: PermissionSubject, entity: Entity) {
  const locked = roleLocked[entity];
  if (locked && !locked.includes(typeof subject === "string" ? subject : subject.role)) return false;
  return resolved(subject).edit.includes(entity);
}
/** Autorizar solicitudes de compra desde el límite: Gerencia siempre, y quien tenga el permiso (Socio, Presidencia). */
export function canApprovePurchases(subject: PermissionSubject) {
  return (typeof subject === "string" ? subject : subject.role) === "gerencia" || Boolean(resolved(subject).actions?.includes("approvePurchases"));
}
export function canDelete(subject: PermissionSubject) { return (typeof subject === "string" ? subject : subject.role) === "gerencia"; }
