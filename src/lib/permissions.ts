import type { Entity, Role } from "./constants";

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

export function canRead(role: Role, entity: Entity) { void role; void entity; return true; }
export function canWrite(role: Role, entity: Entity) { return writeAccess[entity].includes(role); }
export function canDelete(role: Role) { return role === "gerencia"; }
