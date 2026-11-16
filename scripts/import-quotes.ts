import { readSheet } from "read-excel-file/node";
import { connectDB } from "../src/lib/db";
import { Client, Quote, Work } from "../src/lib/models";
import { listWorkCategories } from "../src/lib/work-categories";

// Carga las cotizaciones que Administración pasó en Excel (12/11/2026), con su
// obra. Columnas: N° Cotización, Cliente, Trabajo, Presupuesto, Estado, Fecha.
// - "V 01-1393" es de TV Pino y "C 01-2114" de Constructora (la letra del número).
// - El cliente se busca por nombre (sin el código de Tango del principio); si no
//   está, se da de alta.
// - APROBADO, EN EJECUCIÓN y FINALIZADO quedan pasadas a obra. La obra queda
//   pendiente de inicio, en curso o finalizada. Si ya hay una obra con ese número
//   (la "V1400 ..." de la planilla de quincena), se le asocia la cotización.
// - SIN RESPUESTA queda en seguimiento, sin obra.
// - No reserva stock ni manda avisos: son trabajos que ya están en marcha.
// - Una cotización que ya está (mismo número) no se toca. Un número repetido en
//   la planilla se carga una vez y se avisa.
// Sin --apply solo muestra lo que haría.
// pnpm quotes:import <planilla.xlsx> [--apply]
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file = args.find(arg => !arg.startsWith("--"));

const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const clientName = (value: unknown) => String(value ?? "").replace(/^\s*\(?\d+\)?\s*-?\s*/, "").trim();

/** El rubro por el tipo de trabajo; los que no dicen (mano de obra, materiales) quedan sin rubro. */
function categoryKey(work: string) {
  const text = normalize(work);
  if (/POLIURE|ESPUMA/.test(text)) return "poliuretano";
  if (/IMPERMEABILIZ/.test(text)) return "impermeabilizacion";
  if (/ALTURA|VIDRIO/.test(text)) return "altura";
  if (/REVOQUE|ALBANIL|DURLOCK|TABIQUER/.test(text)) return "albanileria";
  if (/PINTURA/.test(text)) return "exterior";
  return "";
}

function parseDate(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const match = String(value ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12)) : null;
}

const STATUS: Record<string, { quote: string; work?: string }> = {
  APROBADO: { quote: "convertida", work: "planificada" },
  ENEJECUCION: { quote: "convertida", work: "en_curso" },
  FINALIZADO: { quote: "convertida", work: "terminada" },
  SINRESPUESTA: { quote: "seguimiento" },
};

async function main() {
  if (!file) throw new Error("Uso: pnpm quotes:import <planilla.xlsx> [--apply]");
  const matrix = await readSheet(file);
  const headers = matrix[0].map(normalize);
  const at = (name: string) => headers.findIndex(header => header.startsWith(name));
  const [numberAt, clientAt, workAt, amountAt, statusAt, dateAt] = ["NCOTIZACION", "CLIENTE", "TRABAJO", "PRESUPUESTO", "ESTADO", "FECHA"].map(at);
  if ([numberAt, clientAt, workAt, amountAt, statusAt].some(index => index < 0)) throw new Error(`Faltan columnas (encontré: ${matrix[0].join(", ")})`);

  await connectDB();
  const categories = new Map((await listWorkCategories()).map(category => [String(category.key), category._id]));
  const clients = await Client.find().select("name").lean<Array<{ _id: unknown; name: string }>>();
  const works = await Work.find().select("code name quoteId").lean<Array<{ _id: unknown; code: string; name: string; quoteId?: unknown }>>();
  const seen = new Set<string>();
  const counts = { quotes: 0, works: 0, linked: 0, clients: 0, skipped: 0 };
  const notes: string[] = [];

  for (const [index, row] of matrix.slice(1).entries()) {
    const line = index + 2;
    const number = String(row[numberAt] ?? "").replace(/\s+/g, " ").trim();
    const parsed = number.match(/^([VC])\s*0?1\s*-\s*(\d+)$/i);
    if (!parsed) { notes.push(`Fila ${line}: "${number}" no es un número de cotización: no se carga`); counts.skipped++; continue; }
    if (seen.has(number)) { notes.push(`Fila ${line}: ${number} está repetida en la planilla: se cargó la primera`); counts.skipped++; continue; }
    seen.add(number);
    const [, letter, digits] = parsed;
    const tango = Number(digits);
    if (await Quote.exists({ number: { $in: [number, String(tango)] } })) { notes.push(`Fila ${line}: ${number} ya está cargada: no se toca`); counts.skipped++; continue; }

    const status = STATUS[normalize(row[statusAt])];
    if (!status) { notes.push(`Fila ${line}: ${number} tiene el estado "${row[statusAt]}", que no conozco: no se carga`); counts.skipped++; continue; }
    const company = letter.toUpperCase() === "C" ? "constructora" : "tvp";
    const trade = String(row[workAt] ?? "").trim();
    const raw = row[amountAt];
    const amount = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/\./g, "").replace(",", "."));
    const amountCents = Number.isFinite(amount) ? Math.round(amount * 100) : 0;
    const description = Number.isFinite(amount) ? undefined : `Presupuesto en la planilla: ${String(raw)}`;
    if (description) notes.push(`Fila ${line}: ${number} tiene el presupuesto "${raw}": va en $ 0 con la nota`);
    const date = parseDate(row[dateAt]);
    if (dateAt >= 0 && row[dateAt] && !date) notes.push(`Fila ${line}: ${number} tiene la fecha "${row[dateAt]}", que no se entiende: queda la de hoy`);

    const name = clientName(row[clientAt]);
    const key = normalize(name);
    let client = clients.find(candidate => normalize(candidate.name) === key);
    // Si no está igual, uno solo cuyo nombre lo contenga ("CASARO" es "CASARO ZOILO AGUSTIN"); entre
    // varios, el que termina igual ("NEWEN I" es "CONSORCIO PROPIETARIOS NEWEN I", no "NEWEN II").
    // Al revés no: "HORACIO LEALE" no es "HORACIO".
    if (!client && key.length >= 5) {
      let similar = clients.filter(candidate => normalize(candidate.name).includes(key));
      if (similar.length > 1) similar = similar.filter(candidate => normalize(candidate.name).endsWith(key)).length === 1 ? similar.filter(candidate => normalize(candidate.name).endsWith(key)) : similar;
      if (similar.length === 1) { client = similar[0]; notes.push(`Fila ${line}: el cliente "${name}" se toma como "${client.name}"`); }
      else if (similar.length > 1) notes.push(`Fila ${line}: el cliente "${name}" se parece a ${similar.slice(0, 4).map(candidate => `"${candidate.name}"`).join(", ")}${similar.length > 4 ? "…" : ""}`);
    }
    if (!client) {
      counts.clients++;
      notes.push(`Fila ${line}: el cliente "${name}" no está: se da de alta`);
      client = apply ? (await Client.create({ name, phones: [] })).toObject() as { _id: unknown; name: string } : { _id: null, name };
      clients.push(client);
    }

    const title = `${trade} - ${client.name}`;
    const workCategoryId = categories.get(categoryKey(trade)) || undefined;
    // La obra de la planilla de quincena se llama "V1400 CASINO PASO": se reconoce por la letra y el número.
    const existingWork = works.find(work => !work.quoteId && new RegExp(`^${letter}\\s*${tango}\\b`, "i").test(String(work.code)));
    const stamp = date || new Date();
    const history = [{ action: "import", note: "Cargada desde la planilla de cotizaciones de Administración", at: new Date() }];
    counts.quotes++;
    if (status.work && existingWork) counts.linked++;
    else if (status.work) counts.works++;
    console.log(`${number} · ${company} · ${client.name} · ${trade} · $ ${(amountCents / 100).toFixed(2)} · ${status.quote}${status.work ? existingWork ? ` → obra existente ${existingWork.code}` : ` → obra nueva (${status.work})` : ""}${workCategoryId ? "" : " · sin rubro"}`);
    if (!apply) continue;

    const quote = await Quote.collection.insertOne({
      number, company, clientId: client._id, title, version: 1, amountCents, estimatedCostCents: 0, status: status.quote,
      ...(description ? { description } : {}), ...(workCategoryId ? { workCategoryId } : {}),
      items: [], overheads: [], cascade: {}, history, adjustments: [], photos: [], createdAt: stamp, updatedAt: new Date(),
    });
    if (!status.work) continue;
    if (existingWork) {
      await Work.updateOne({ _id: existingWork._id }, { $set: { quoteId: quote.insertedId, ...(workCategoryId ? { workCategoryId } : {}) } });
      await Quote.updateOne({ _id: quote.insertedId }, { $set: { workId: existingWork._id } });
      existingWork.quoteId = quote.insertedId;
      continue;
    }
    const work = await Work.create({
      code: `OB-${number}`, name: title, clientId: client._id, quoteId: quote.insertedId, ...(workCategoryId ? { workCategoryId } : {}),
      budgetCents: amountCents, status: status.work, ...(date ? { startDate: date } : {}),
    });
    await Quote.updateOne({ _id: quote.insertedId }, { $set: { workId: work._id } });
  }

  console.log(`\n${counts.quotes} cotizaciones, ${counts.works} obras nuevas, ${counts.linked} asociadas a obras que ya estaban, ${counts.clients} clientes nuevos, ${counts.skipped} filas sin cargar.`);
  if (notes.length) console.log(`\nAvisos:\n${notes.join("\n")}`);
  if (!apply) console.log("\nNo se cargó nada: agregá --apply para cargarlas.");
  process.exit(0);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
