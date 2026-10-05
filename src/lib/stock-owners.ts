import { COMPANY_KEYS, type CompanyKey } from "./companies";
import { WAREHOUSES, type WarehouseKey } from "./warehouses";
import { levelsOf } from "./stock-levels";

/*
 * De quién es cada existencia (punto 3 de la especificación). El stock tiene un
 * catálogo único, pero cada cantidad guarda su CUIT propietario por ubicación:
 * en el Central puede haber 10 bolsas de Trabajos Verticales y 5 de la
 * Constructora. La empresa dueña es independiente de dónde está y de quién
 * factura después.
 *
 * Se guarda en `owners` del material: { central: { tvp: 10, constructora: 5 }, salon: {…}, transito: {…} }.
 * Lo que había antes de esto no tiene dueño cargado: queda "sin_asignar"
 * hasta que se mueva o se ajuste.
 */

export const OWNER_KEYS = [...COMPANY_KEYS, "sin_asignar"] as const;
export type OwnerKey = (typeof OWNER_KEYS)[number];
export type Location = WarehouseKey | "transito";
export type OwnerSplit = Partial<Record<OwnerKey, number>>;
export type OwnerMatrix = Record<Location, OwnerSplit>;
export type OwnerPart = { owner: OwnerKey; quantity: number };

export const ownerLabels: Record<OwnerKey, string> = { tvp: "TV Pino", constructora: "Constructora Pino", sin_asignar: "Sin asignar" };

const round = (value: number) => Math.round(value * 1000) / 1000;
const sumOf = (split: OwnerSplit) => round(Object.values(split).reduce((total, value) => total + Number(value || 0), 0));

export function isOwner(value: unknown): value is CompanyKey {
  return COMPANY_KEYS.includes(value as CompanyKey);
}

/**
 * La matriz de dueños de un material, siempre cuadrada con lo que hay en cada
 * ubicación: si la cantidad de un depósito no coincide con la suma de sus
 * dueños (un material viejo, un ajuste de antes), la diferencia es "sin asignar".
 */
export function ownersOf(item: Record<string, unknown>): OwnerMatrix {
  const saved = (item.owners && typeof item.owners === "object" ? item.owners : {}) as Partial<Record<Location, OwnerSplit>>;
  const levels = levelsOf(item);
  const quantities: Record<Location, number> = { ...levels, transito: Number(item.transitQty || 0) };
  const matrix = {} as OwnerMatrix;
  for (const location of [...WAREHOUSES.map(warehouse => warehouse.key), "transito"] as Location[]) {
    const split: OwnerSplit = {};
    for (const owner of OWNER_KEYS) {
      const value = Number(saved[location]?.[owner] || 0);
      if (value > 0) split[owner] = round(value);
    }
    const difference = round(quantities[location] - sumOf(split));
    if (difference > 0) split.sin_asignar = round((split.sin_asignar || 0) + difference);
    if (difference < 0) shrink(split, -difference);
    matrix[location] = split;
  }
  return matrix;
}

/** Saca una cantidad de una ubicación sin elegir dueño (para cuadrar): primero lo sin asignar. */
function shrink(split: OwnerSplit, quantity: number) {
  let pending = quantity;
  for (const owner of ["sin_asignar", ...COMPANY_KEYS] as OwnerKey[]) {
    if (pending <= 0) break;
    const take = Math.min(pending, Number(split[owner] || 0));
    if (take > 0) { split[owner] = round(Number(split[owner]) - take); pending = round(pending - take); if (!split[owner]) delete split[owner]; }
  }
}

/**
 * Saca `quantity` de una ubicación y dice de qué dueños salió. Primero lo del
 * dueño preferido (por ejemplo, la empresa de la obra), después lo sin asignar
 * y por último lo de la otra empresa. No controla que alcance: eso lo hace quien llama.
 */
export function takeOwners(matrix: OwnerMatrix, location: Location, quantity: number, preferred?: OwnerKey): OwnerPart[] {
  const split = matrix[location];
  const order = [...new Set([preferred, "sin_asignar", ...COMPANY_KEYS].filter(Boolean) as OwnerKey[])];
  const parts: OwnerPart[] = [];
  let pending = round(quantity);
  for (const owner of order) {
    if (pending <= 0) break;
    const take = round(Math.min(pending, Number(split[owner] || 0)));
    if (take <= 0) continue;
    split[owner] = round(Number(split[owner]) - take);
    if (!split[owner]) delete split[owner];
    parts.push({ owner, quantity: take });
    pending = round(pending - take);
  }
  // Si no alcanzó (un ajuste a la baja sobre datos viejos), lo que falta sale sin dueño.
  if (pending > 0) parts.push({ owner: "sin_asignar", quantity: pending });
  return parts;
}

export function addOwners(matrix: OwnerMatrix, location: Location, parts: OwnerPart[]) {
  const split = matrix[location];
  for (const part of parts) if (part.quantity > 0) split[part.owner] = round(Number(split[part.owner] || 0) + part.quantity);
}

/** Lo que queda guardado en el material: sin ceros. */
export function compactOwners(matrix: OwnerMatrix) {
  return Object.fromEntries(Object.entries(matrix).map(([location, split]) => [location, Object.fromEntries(Object.entries(split).filter(([, value]) => Number(value) > 0))]));
}

/** El total de cada dueño sumando todas las ubicaciones. */
export function ownerTotals(matrix: OwnerMatrix): OwnerSplit {
  const totals: OwnerSplit = {};
  for (const split of Object.values(matrix)) for (const [owner, value] of Object.entries(split)) totals[owner as OwnerKey] = round(Number(totals[owner as OwnerKey] || 0) + Number(value || 0));
  return totals;
}

/** Cuánto hay de un dueño en una ubicación. */
export function ownedAt(matrix: OwnerMatrix, location: Location, owner: OwnerKey) {
  return Number(matrix[location]?.[owner] || 0);
}

