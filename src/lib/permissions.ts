import { entities, viewSections, type Entity, type Role, type ViewSection } from "./constants";

export type UserPermissions = { view: ViewSection[]; edit: Entity[] };
export type PermissionSubject = Role | { role: Role; permissions?: Partial<UserPermissions> };

const writeAccess: Record<Entity, Role[]> = {
  clients: ["gerencia", "ventas", "administracion"],
  quotes: ["gerencia", "ventas"],
  works: ["gerencia", "arquitecto", "auxiliar"],
  suppliers: ["gerencia", "compras", "administracion"],
  purchases: ["gerencia", "compras", "administracion"],
  expenses: ["gerencia", "compras", "administracion"],
  invoices: ["gerencia", "administracion"],
  collections: ["gerencia", "administracion"],
  payments: ["gerencia", "administracion", "compras"],
  checks: ["gerencia", "administracion"],
  cash: ["gerencia", "administracion"],
  tasks: ["gerencia", "arquitecto", "auxiliar", "administracion", "compras", "ventas"],
};

export function defaultPermissionsForRole(role: Role): UserPermissions {
  return {
    view: [...viewSections],
    edit: entities.filter(entity => writeAccess[entity].includes(role)),
  };
}

export function normalizePermissions(role: Role, permissions?: Partial<UserPermissions> | null): UserPermissions {
  if (!permissions || !Array.isArray(permissions.view) || !Array.isArray(permissions.edit)) return defaultPermissionsForRole(role);
  const view = [...new Set(permissions.view)].filter((section): section is ViewSection => viewSections.includes(section as ViewSection));
  const edit = [...new Set(permissions.edit)].filter((entity): entity is Entity => entities.includes(entity as Entity) && view.includes(entity as ViewSection));
  return { view, edit };
}

function resolved(subject: PermissionSubject) {
  return typeof subject === "string" ? defaultPermissionsForRole(subject) : normalizePermissions(subject.role, subject.permissions);
}

export function canViewSection(subject: PermissionSubject, section: ViewSection) { return resolved(subject).view.includes(section); }
export function canRead(subject: PermissionSubject, entity: Entity) { return canViewSection(subject, entity); }
export function canWrite(subject: PermissionSubject, entity: Entity) { return resolved(subject).edit.includes(entity); }
export function canDelete(subject: PermissionSubject) { return (typeof subject === "string" ? subject : subject.role) === "gerencia"; }
