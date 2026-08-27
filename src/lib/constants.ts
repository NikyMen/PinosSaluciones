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
  "workers",
  "suppliers",
  "stock",
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

export const viewSections = ["dashboard", ...entities, "reports"] as const;

export type ViewSection = (typeof viewSections)[number];

export const entityLabels: Record<Entity, string> = {
  clients: "Clientes",
  quotes: "Cotizaciones",
  works: "Obras",
  workers: "Trabajadores",
  suppliers: "Proveedores",
  stock: "Stock",
  purchases: "Órdenes de compra",
  expenses: "Compras y gastos",
  invoices: "Facturación",
  collections: "Cobranzas",
  payments: "Pagos",
  checks: "Cheques",
  cash: "Caja y bancos",
  tasks: "Tareas y pendientes",
};

export const viewSectionLabels: Record<ViewSection, string> = {
  dashboard: "Tablero gerencial",
  ...entityLabels,
  reports: "iA y Reportes",
};
