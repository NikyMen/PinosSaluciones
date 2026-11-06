import { connectDB } from "../src/lib/db";
import { Client, nextPartyCode, Supplier } from "../src/lib/models";

// Les pone código a los proveedores y clientes que no tienen (los de antes del
// anexo de Tesorería v5.1), por fecha de alta: el más viejo, el 1. Los nuevos
// ya lo reciben solos. Se puede correr las veces que haga falta: sólo toca los
// que no tienen. Sin --apply solo cuenta lo que haría.
// pnpm migrate:party-codes [--apply]
const apply = process.argv.includes("--apply");

async function main() {
  await connectDB();
  for (const [kind, model, label] of [["suppliers", Supplier, "proveedores"], ["clients", Client, "clientes"]] as const) {
    const missing = await model.find({ code: null }).sort({ createdAt: 1, _id: 1 }).select("name").lean<Array<{ _id: unknown; name: string }>>();
    console.log(`${missing.length} ${label} sin código`);
    if (!apply) continue;
    for (const party of missing) await model.updateOne({ _id: party._id }, { $set: { code: await nextPartyCode(kind) } });
  }
  console.log(apply ? "Listo." : "No se cambió nada: corré con --apply para hacerlo.");
  process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
