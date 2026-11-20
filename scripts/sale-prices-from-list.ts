import { connectDB } from "../src/lib/db";
import { applyListSalePrices } from "../src/lib/sale-prices";
import { money } from "../src/lib/format";

// Pasa el precio final al consumidor de las listas vigentes (Protex lo trae con
// IVA) al precio de venta sin IVA de los materiales de Stock que están en esa
// lista: por el código interno igual al de la lista, o por el código antes del
// guion ("JUE905-BIDON" es el "JUE905"). Cada cambio queda en el historial de
// precios del material, como "Lista de precios". Desde ahí en adelante lo hace
// solo cada lista nueva que se carga (src/lib/price-list-service.ts).
// Sin --apply sólo muestra lo que haría.
// pnpm prices:from-list [--apply]
const apply = process.argv.slice(2).includes("--apply");

async function main() {
  await connectDB();
  const changes = await applyListSalePrices({ apply, actor: { name: "Lista de precios" } });
  for (const change of changes) {
    console.log(`${change.sku.padEnd(16)} ${change.name} → ${change.previousCents ? `${money(change.previousCents)} → ` : ""}${money(change.salePriceCents)} sin IVA (${change.listName})`);
  }
  console.log(`\n${changes.length} materiales ${apply ? "con el precio de la lista" : "tomarían el precio de la lista"}.`);
  console.log(apply ? "Listo." : "No se cambió nada: corré con --apply para hacerlo.");
  process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
