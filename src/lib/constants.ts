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
  "assets",
  "accounts",
] as const;

export type Entity = (typeof entities)[number];

// "accounting" es Contabilidad: el libro IVA y los movimientos por cuenta. Solo se mira, no se edita.
export const viewSections = ["dashboard", ...entities, "calendario", "reports", "accounting"] as const;

export type ViewSection = (typeof viewSections)[number];

export const entityLabels: Record<Entity, string> = {
  clients: "Clientes",
  quotes: "Cotizaciones",
  works: "Obras",
  workers: "Personal",
  suppliers: "Proveedores",
  stock: "Stock",
  purchases: "Solicitudes y órdenes de compra",
  expenses: "Facturas de compra y gastos",
  invoices: "Facturas de venta",
  collections: "Cobranzas",
  payments: "Órdenes de pago y pagos",
  checks: "Cheques",
  cash: "Caja y bancos",
  tasks: "Tareas y pendientes",
  assets: "Bienes de uso",
  accounts: "Plan de cuentas",
};

export const viewSectionLabels: Record<ViewSection, string> = {
  dashboard: "Tablero gerencial",
  ...entityLabels,
  calendario: "Calendario",
  reports: "iA y Reportes",
  accounting: "Contabilidad",
};
