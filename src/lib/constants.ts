export const ROLES = [
  "gerencia",
  "arquitecto",
  "auxiliar",
  "administracion",
  "compras",
  "ventas",
  "contador",
] as const;

export type Role = (typeof ROLES)[number];

export const roleLabels: Record<Role, string> = {
  gerencia: "Gerencia",
  arquitecto: "Arquitecto",
  auxiliar: "Auxiliar de arquitectura",
  administracion: "Administración",
  compras: "Compras y logística",
  ventas: "Ventas",
  contador: "Contador",
};

export const entities = [
  "clients",
  "quotes",
  "works",
  "suppliers",
  "purchases",
  "expenses",
  "invoices",
  "collections",
  "payments",
  "checks",
  "cash",
  "tasks",
] as const;

export type Entity = (typeof entities)[number];

export const entityLabels: Record<Entity, string> = {
  clients: "Clientes",
  quotes: "Cotizaciones",
  works: "Obras",
  suppliers: "Proveedores",
  purchases: "Órdenes de compra",
  expenses: "Compras y gastos",
  invoices: "Facturación",
  collections: "Cobranzas",
  payments: "Pagos",
  checks: "Cheques",
  cash: "Caja y bancos",
  tasks: "Tareas",
};
