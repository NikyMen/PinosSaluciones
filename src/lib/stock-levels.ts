import { WAREHOUSES, type WarehouseKey } from "./warehouses";

/*
 * Cuánto hay de un material en cada depósito. Se guarda en campos planos
 * (`qty_central`, `qty_salon`) para que la tabla, el formulario y la
 * exportación a Excel los traten como cualquier otro campo. `quantity` sigue
 * siendo el total: lo leen el tablero, las inspecciones y los reportes.
 */

export const qtyField = (warehouse: WarehouseKey) => `qty_${warehouse}`;
export const minField = (warehouse: WarehouseKey) => `min_${warehouse}`;

export type Levels = Record<WarehouseKey, number>;

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Las cantidades por depósito. Un material cargado antes de que hubiera
 * depósitos no tiene ninguna: todo lo que tenía está en el Central.
 */
export function levelsOf(item: Record<string, unknown>): Levels {
  const separated = WAREHOUSES.some(warehouse => typeof item[qtyField(warehouse.key)] === "number");
  return Object.fromEntries(WAREHOUSES.map((warehouse, index) => [
    warehouse.key,
    round(separated ? Number(item[qtyField(warehouse.key)] || 0) : index === 0 ? Number(item.quantity || 0) : 0),
  ])) as Levels;
}

/** El mínimo de cada depósito. El mínimo viejo (uno solo) se toma como el del Central. */
export function minimumsOf(item: Record<string, unknown>): Levels {
  const separated = WAREHOUSES.some(warehouse => typeof item[minField(warehouse.key)] === "number");
  return Object.fromEntries(WAREHOUSES.map((warehouse, index) => [
    warehouse.key,
    separated ? Number(item[minField(warehouse.key)] || 0) : index === 0 ? Number(item.minQuantity || 0) : 0,
  ])) as Levels;
}

/** Los depósitos donde el material quedó en el mínimo o por debajo. */
export function lowWarehouses(item: Record<string, unknown>) {
  const levels = levelsOf(item);
  const minimums = minimumsOf(item);
  return WAREHOUSES.filter(warehouse => minimums[warehouse.key] > 0 && levels[warehouse.key] <= minimums[warehouse.key]);
}

export const totalOf = (levels: Levels) => round(Object.values(levels).reduce((total, value) => total + value, 0));

/**
 * Cómo sale una cantidad a obra: primero del Central y, lo que no alcance,
 * del Salón. Es el caso de la reunión: piden 20, el Central tiene 17 y el
 * Salón manda los 3 que faltan. Si entre los dos no alcanza, lo que falta
 * queda en `missing`.
 */
export function splitDelivery(levels: Levels, quantity: number) {
  let pending = round(quantity);
  const parts: Array<{ warehouse: WarehouseKey; quantity: number }> = [];
  for (const warehouse of WAREHOUSES) {
    if (pending <= 0) break;
    const take = round(Math.min(pending, Math.max(0, levels[warehouse.key])));
    if (take > 0) { parts.push({ warehouse: warehouse.key, quantity: take }); pending = round(pending - take); }
  }
  return { parts, missing: Math.max(0, pending) };
}
