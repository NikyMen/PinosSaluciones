import { StockItem } from "./models";
import { schemas } from "./schemas";
import { audit } from "./audit";
import { beforeCreate } from "./document-rules";
import { applyStockMovement } from "./stock-service";
import { levelsOf } from "./stock-levels";
import { recordSalePriceChange } from "./sale-prices";
import { saleCentsFromGross } from "./list-price-match";
import { DEFAULT_WAREHOUSE, WAREHOUSES, type WarehouseKey } from "./warehouses";
import { COMPANIES, COMPANY_KEYS, type CompanyKey } from "./companies";
import type { Session } from "./auth";

/*
 * La importación de Stock (pedido C6 de Ventas, 10/11/2026: cargar los
 * productos del Salón desde el Excel). Además de dar de alta el catálogo:
 *
 * - un producto que ya existe (mismo código de barras o código interno; sin
 *   códigos en la fila, mismo nombre) se actualiza en lugar de duplicarse;
 * - el precio de venta queda en el historial de precios como "Importación";
 * - con Cantidad, lo contado entra al depósito de la columna Depósito (sin
 *   dato, el Galpón) a nombre de la Empresa propietaria, con un ajuste;
 * - antes de escribir se puede pedir la vista previa: cuántos se dan de alta,
 *   cuántos se actualizan y qué filas tienen error.
 */

/** Las columnas que sólo existen en la planilla de Stock, con los encabezados que se aceptan. */
export const STOCK_IMPORT_COLUMNS: Array<{ key: string; label: string; aliases: string[] }> = [
  { key: "importQty", label: "Cantidad", aliases: ["cantidad", "existencia", "existencias", "stock", "stockactual"] },
  { key: "importWarehouse", label: "Depósito", aliases: ["deposito", "ubicacion"] },
  { key: "importOwner", label: "Empresa propietaria", aliases: ["empresapropietaria", "empresa", "propietario", "cuitpropietario"] },
  { key: "importCostCents", label: "Costo unitario", aliases: ["costounitario", "costo", "preciodecosto", "preciocosto"] },
  { key: "importGrossCents", label: "Precio de venta con IVA", aliases: ["preciodeventaconiva", "precioconiva", "preciofinal", "pvp"] },
];
/** Otros encabezados habituales de una planilla de productos, llevados a los campos de Stock. */
export const STOCK_HEADER_ALIASES: Record<string, string> = {
  producto: "name", descripcion: "name", nombre: "name", articulo: "name",
  codigo: "sku", cod: "sku", codigodebarra: "barcode", ean: "barcode",
  precio: "salePriceCents", preciodeventa: "salePriceCents", preciosiniva: "salePriceCents", precioneto: "salePriceCents",
  unidad: "unit", categoria: "category",
};

const norm = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exact = (value: string) => new RegExp(`^\\s*${escapeRegex(value.trim())}\\s*$`, "i");
const amount = (value: unknown) => typeof value === "number" ? value : Number(String(value ?? "").replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));

function warehouseOf(value: unknown): WarehouseKey | null {
  const text = norm(value);
  if (!text) return DEFAULT_WAREHOUSE;
  const found = WAREHOUSES.find(entry => norm(entry.key) === text || norm(entry.label) === text || norm(entry.short) === text);
  if (found) return found.key;
  return text.includes("salon") ? "salon" : text.includes("galpon") || text.includes("central") ? "central" : null;
}

function ownerOf(value: unknown, warehouse: WarehouseKey): CompanyKey | null {
  const text = norm(value);
  // Sin dato, la empresa que compra para ese depósito: TV Pino en el Galpón y Constructora Pino en el Salón.
  if (!text) return warehouse === "salon" ? "constructora" : "tvp";
  const found = COMPANY_KEYS.find(key => norm(key) === text || norm(COMPANIES[key].short) === text || norm(COMPANIES[key].legalName) === text || norm(COMPANIES[key].cuit) === text);
  if (found) return found;
  return text.includes("constructora") ? "constructora" : text.includes("vertical") || text.includes("tvpino") || text === "tvp" ? "tvp" : null;
}

type ItemDoc = Parameters<typeof applyStockMovement>[0];
export type StockImportResult = { preview: boolean; imported: number; updated: number; withStock: number; errors: Array<{ row: number; error: string }>; total: number };

/** `rows` ya viene con los encabezados resueltos, los importes en centavos y las relaciones (proveedor) por id. */
export async function importStockRows(rows: Array<{ row: Record<string, unknown>; line: number }>, errors: Array<{ row: number; error: string }>, total: number, session: Session, preview: boolean): Promise<StockImportResult> {
  let imported = 0, updated = 0, withStock = 0;
  // Un producto va una sola vez por planilla: la segunda fila con el mismo código no pisa a la primera.
  const seen = new Set<string>();
  for (const { row, line } of rows) {
    try {
      const extra = Object.fromEntries(STOCK_IMPORT_COLUMNS.map(column => [column.key, row[column.key]]));
      for (const column of STOCK_IMPORT_COLUMNS) delete row[column.key];
      for (const key of ["sku", "barcode", "name"]) if (row[key] !== undefined) row[key] = String(row[key]).trim();
      // El precio final (con IVA) de la planilla pasa al precio de venta sin IVA, si no vino ya.
      if (extra.importGrossCents !== undefined && row.salePriceCents === undefined) row.salePriceCents = saleCentsFromGross(Number(extra.importGrossCents) || 0);
      const hasQty = extra.importQty !== undefined && String(extra.importQty).trim() !== "";
      const quantity = hasQty ? amount(extra.importQty) : 0;
      if (hasQty && !(quantity >= 0)) throw new Error(`Cantidad: "${String(extra.importQty)}" no es un número`);
      const warehouse = warehouseOf(extra.importWarehouse);
      if (!warehouse) throw new Error(`Depósito: no se reconoce "${String(extra.importWarehouse)}" (Galpón o Salón de Ventas)`);
      const owner = ownerOf(extra.importOwner, warehouse);
      if (!owner) throw new Error(`Empresa propietaria: no se reconoce "${String(extra.importOwner)}"`);
      const costCents = Math.max(0, Math.round(Number(extra.importCostCents) || 0));

      const barcode = String(row.barcode || ""), sku = String(row.sku || ""), name = String(row.name || "");
      const existing = (barcode ? await StockItem.findOne({ barcode: exact(barcode) }) : null)
        || (sku ? await StockItem.findOne({ sku: exact(sku) }) : null)
        || (!barcode && !sku && name ? await StockItem.findOne({ name: exact(name) }) : null);
      const key = norm(barcode || sku || name);
      if (key && seen.has(key)) throw new Error("Está repetido en la planilla: quedó la primera fila");
      seen.add(key);
      let item = existing as unknown as (ItemDoc & { salePriceCents?: number; avgCostCents: number }) | null;

      if (existing) {
        const parsed = schemas.stock.partial().safeParse(row);
        if (!parsed.success) throw new Error(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
        // Sólo lo que trae la planilla: lo que no vino queda como estaba.
        const changes = Object.fromEntries(Object.entries(parsed.data as Record<string, unknown>).filter(([field, value]) => field in row && value !== undefined && value !== ""));
        // Los códigos con que se lo encontró no se reescriben (la planilla puede traerlos en minúscula); sí se completan si faltaban.
        for (const code of ["sku", "barcode"]) if (existing.get(code)) delete changes[code];
        if (!preview) {
          const before = existing.toObject();
          if (Object.keys(changes).length) { existing.set(changes); await existing.save(); }
          if ("salePriceCents" in changes) await recordSalePriceChange(existing._id, before.salePriceCents, changes.salePriceCents, { userId: session.userId, name: session.name }, "importacion");
          await audit(session, "import_update", "stock", existing._id, before, existing.toObject());
        }
        updated++;
      } else {
        // El rubro y la unidad más comunes, si la planilla no los trae.
        const parsed = schemas.stock.safeParse({ category: "materiales", unit: "unidad", ...row });
        if (!parsed.success) throw new Error(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
        if (!preview) {
          const data = parsed.data as Record<string, unknown>;
          await beforeCreate("stock", data, session);
          const created = await StockItem.create(data as never);
          if (Number(data.salePriceCents) > 0) await recordSalePriceChange(created._id, undefined, data.salePriceCents, { userId: session.userId, name: session.name }, "importacion");
          await audit(session, "import", "stock", created._id, null, created.toObject());
          item = created as unknown as typeof item;
        }
        imported++;
      }

      // La existencia: lo contado en ese depósito, con un ajuste a nombre de la empresa propietaria.
      if (hasQty) {
        if (!preview && item) {
          const current = levelsOf(item as unknown as Record<string, unknown>)[warehouse];
          // El costo de la planilla sólo se toma si el material todavía no tiene uno (no pisa el promedio de las compras).
          const setCost = costCents > 0 && !Number(item.avgCostCents);
          if (setCost) item.avgCostCents = costCents;
          if (Math.abs(current - quantity) > 1e-9) await applyStockMovement(item, { kind: "ajuste", warehouse, quantity, owner, note: "Importación de la planilla de Stock" }, session);
          else if (setCost) { item.valueCents = Math.round(Number(item.quantity || 0) * costCents); await item.save(); }
        }
        withStock++;
      }
    } catch (error) { errors.push({ row: line, error: error instanceof Error ? error.message : "Fila inválida" }); }
  }
  errors.sort((a, b) => a.row - b.row);
  return { preview, imported, updated, withStock, errors, total };
}
