import { readSheet } from "read-excel-file/node";
import { connectDB } from "../src/lib/db";
import { StockItem, User } from "../src/lib/models";
import { applyStockMovement, type MovementInput } from "../src/lib/stock-service";
import { audit } from "../src/lib/audit";
import { levelsOf } from "../src/lib/stock-levels";
import type { Session } from "../src/lib/auth";

// Carga un inventario del Galpón desde una planilla con las columnas ARTICULO,
// COD. BARRA y CANTIDAD. Cada renglón es un ajuste: fija lo contado en el
// Galpón y deja el movimiento (y la auditoría), como un conteo hecho a mano.
// El material se busca por código de barras y, si no, por nombre; si no está,
// se da de alta. Sin --apply solo muestra lo que haría.
// pnpm stock:galpon <planilla.xlsx> [--apply] [--owner tvp|constructora] [--zero-missing] [--user correo]
//   --zero-missing: lo que hoy está en el Galpón y no figura en la planilla queda en cero.
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const zeroMissing = args.includes("--zero-missing");
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const owner = (option("--owner") || "tvp") as "tvp" | "constructora";
const file = args.find((arg, index) => !arg.startsWith("--") && !["--owner", "--user"].includes(args[index - 1]));
const note = `Inventario del Galpón (${file?.split(/[\\/]/).pop()})`;

const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** "11 CAJAS" → 11. */
function quantityOf(value: unknown) {
  if (typeof value === "number") return value;
  const match = String(value ?? "").replace(",", ".").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

function categoryOf(name: string) {
  if (/GUANTE|BARBIJO|MAMELUCO|ANTIPARRA|CASCO/.test(name)) return "seguridad";
  if (/PINCEL|FRATACHO|RODILLO|ESPATULA|LLANA/.test(name)) return "herramientas";
  if (/LIJA|VIRUTA|CINTA/.test(name)) return "consumibles";
  return "materiales";
}

function unitOf(name: string) {
  if (/X\s?(4|10|12|20)\s?(LTS?|KG)/.test(name)) return "balde";
  if (/X\s?(25|30)\s?KG|^YESO/.test(name)) return "bolsa";
  return "unidad";
}

async function main() {
  if (!file) throw new Error("Falta la planilla: pnpm stock:galpon <planilla.xlsx> [--apply]");
  const matrix = await readSheet(file);
  const headers = matrix[0].map(normalize);
  const column = (...names: string[]) => headers.findIndex(header => names.includes(header));
  const nameAt = column("ARTICULO", "NOMBRE", "MATERIAL"), barcodeAt = column("CODBARRA", "CODIGODEBARRAS", "CODIGO"), qtyAt = column("CANTIDAD");
  if (nameAt < 0 || qtyAt < 0) throw new Error("La planilla tiene que tener las columnas ARTICULO y CANTIDAD");
  const rows = matrix.slice(1).map((values, index) => ({
    row: index + 2, name: String(values[nameAt] ?? "").trim().replace(/\s+/g, " "),
    barcode: barcodeAt >= 0 && values[barcodeAt] != null ? String(values[barcodeAt]).trim() : "",
    raw: values[qtyAt], quantity: quantityOf(values[qtyAt]),
  })).filter(row => row.name);

  // Un código repetido en la planilla no sirve para identificar: se busca por nombre y no se guarda.
  const barcodeCount = new Map<string, number>();
  for (const row of rows) if (row.barcode) barcodeCount.set(row.barcode, (barcodeCount.get(row.barcode) || 0) + 1);

  await connectDB();
  const email = (option("--user") || process.env.ADMIN_EMAIL || "").toLowerCase();
  const user = await User.findOne(email ? { email } : { role: "gerencia", active: true }).lean() as { _id: unknown; name: string; email: string; role: Session["role"] } | null;
  if (!user) throw new Error(`No encontré el usuario ${email || "de gerencia"} para firmar los ajustes`);
  const session: Session = { userId: String(user._id), name: user.name, email: user.email, role: user.role };

  const items = await StockItem.find();
  const touched = new Set<string>();
  console.log(`[galpon] ${rows.length} renglones en ${file}. ${apply ? "APLICANDO" : "Simulación (repetir con --apply)"}. Propietario de lo que suma: ${owner}. Firma: ${user.name}`);

  for (const row of rows) {
    if (!Number.isFinite(row.quantity) || row.quantity < 0) { console.log(`[galpon] fila ${row.row}: ${row.name} — cantidad inválida (${row.raw}), se saltea`); continue; }
    const barcode = row.barcode && barcodeCount.get(row.barcode) === 1 ? row.barcode : "";
    let item = (barcode ? items.find(candidate => candidate.barcode === barcode) : undefined)
      || items.find(candidate => normalize(candidate.name) === normalize(row.name));
    const current = item ? levelsOf(item.toObject() as Record<string, unknown>).central : 0;
    const remark = [typeof row.raw === "string" ? `cantidad "${row.raw}"` : "", row.barcode && !barcode ? `código ${row.barcode} repetido en la planilla, no se guarda` : ""].filter(Boolean).join("; ");
    console.log(`[galpon] fila ${row.row}: ${row.name} — ${item ? `existe (${current} → ${row.quantity})` : `alta nueva (${row.quantity})`}${remark ? ` · ${remark}` : ""}`);
    if (!apply) { if (item) touched.add(String(item._id)); continue; }

    if (!item) {
      item = await StockItem.create({ name: row.name, barcode: barcode || undefined, category: categoryOf(row.name.toUpperCase()), unit: unitOf(row.name.toUpperCase()), notes: typeof row.raw === "string" ? `Inventario: ${row.raw}` : undefined });
      await audit(session, "import", "stock", item._id, null, item.toObject());
      items.push(item);
    } else if (barcode && !item.barcode) item.barcode = barcode;
    touched.add(String(item._id));
    const before = item.toObject();
    const result = await applyStockMovement(item as never, { kind: "ajuste", warehouse: "central", quantity: row.quantity, owner, note } as MovementInput, session);
    await audit(session, "stock_ajuste", "stock", item._id, before, result.item);
  }

  // Lo que el sistema tiene en el Galpón y la planilla no nombra.
  const missing = items.filter(item => !touched.has(String(item._id)) && levelsOf(item.toObject() as Record<string, unknown>).central > 0);
  for (const item of missing) {
    console.log(`[galpon] no está en la planilla: ${item.name} — ${levelsOf(item.toObject() as Record<string, unknown>).central} en el Galpón${zeroMissing ? " → 0" : " (queda igual; --zero-missing lo pone en cero)"}`);
    if (apply && zeroMissing) {
      const before = item.toObject();
      const result = await applyStockMovement(item as never, { kind: "ajuste", warehouse: "central", quantity: 0, note } as MovementInput, session);
      await audit(session, "stock_ajuste", "stock", item._id, before, result.item);
    }
  }
  console.log(`[galpon] listo${apply ? "" : " (simulación)"}`);
  process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
