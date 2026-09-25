/*
 * Los lugares con stock. Lo que se compra entra al Depósito Central (el
 * galpón); del Central se pasa al Salón de Ventas (el mostrador). Los dos
 * pueden mandar material directo a una obra. Para sumar otro lugar (la
 * camioneta, un obrador) alcanza con agregarlo acá.
 */

export const WAREHOUSES = [
  { key: "central", label: "Depósito Central", short: "Central" },
  { key: "salon", label: "Salón de Ventas", short: "Salón" },
] as const;

export type WarehouseKey = (typeof WAREHOUSES)[number]["key"];
export const WAREHOUSE_KEYS = WAREHOUSES.map(warehouse => warehouse.key) as unknown as [WarehouseKey, ...WarehouseKey[]];
export const DEFAULT_WAREHOUSE: WarehouseKey = "central";

export function warehouseLabel(key?: string | null) {
  return WAREHOUSES.find(warehouse => warehouse.key === key)?.label || "Depósito Central";
}

export function isWarehouse(value: unknown): value is WarehouseKey {
  return WAREHOUSES.some(warehouse => warehouse.key === value);
}

/** Dónde se pide que el proveedor entregue una orden: un depósito, o directo en la obra. */
export const DELIVERY_OPTIONS = [...WAREHOUSES.map(warehouse => ({ value: warehouse.key as string, label: warehouse.label })), { value: "obra", label: "En la obra" }];

export function deliveryLabel(value?: string | null) {
  return DELIVERY_OPTIONS.find(option => option.value === value)?.label || "Depósito Central";
}
