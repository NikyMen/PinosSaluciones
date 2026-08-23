// Genera docs/modelo-datos/esquema-actual.md leyendo los modelos reales de Mongoose.
// No parsea el código: importa los schemas e introspecciona sus paths, así que lo que
// sale es exactamente lo que la base va a guardar. Regenerar con `pnpm docs:schema`.
import { writeFileSync } from "node:fs";
import type { Schema } from "mongoose";
import { entityLabels, entities } from "../src/lib/constants";
import { modelByEntity, User, AuditLog, Counter } from "../src/lib/models";

const OUT = "docs/modelo-datos/esquema-actual.md";

const SKIP = new Set(["_id", "__v", "id"]);
const TYPE_LABEL: Record<string, string> = {
  String: "texto", Number: "número", Date: "fecha", Boolean: "sí/no",
  ObjectId: "referencia", Array: "lista", Embedded: "objeto", Mixed: "libre", Map: "mapa",
};

type Row = { field: string; type: string; required: boolean; notes: string[] };

function describe(schema: Schema, prefix = ""): Row[] {
  const rows: Row[] = [];
  schema.eachPath((name, type) => {
    if (SKIP.has(name)) return;
    const anyType = type as unknown as {
      instance?: string;
      options?: Record<string, unknown>;
      enumValues?: string[];
      schema?: Schema;
      caster?: { instance?: string; options?: Record<string, unknown>; schema?: Schema };
    };
    const options = anyType.options ?? {};
    const notes: string[] = [];
    let label = TYPE_LABEL[anyType.instance ?? ""] ?? (anyType.instance ?? "?").toLowerCase();

    const ref = options.ref ?? anyType.caster?.options?.ref;
    if (ref) notes.push(`apunta a **${String(ref)}**`);

    const enums = anyType.enumValues?.length ? anyType.enumValues : undefined;
    if (enums) notes.push(`valores: ${enums.map(v => `\`${v}\``).join(" · ")}`);

    if (options.unique) notes.push("único");
    if (options.min !== undefined) notes.push(`mínimo ${String(options.min)}`);
    if (options.max !== undefined) notes.push(`máximo ${String(options.max)}`);
    if (options.default !== undefined && typeof options.default !== "function") {
      notes.push(`por defecto \`${JSON.stringify(options.default)}\``);
    }

    // listas de subdocumentos: se documentan aparte, debajo
    const nested = anyType.schema ?? anyType.caster?.schema;
    if (anyType.instance === "Array" && !nested) label = "lista";
    if (nested) label = anyType.instance === "Array" ? "lista de objetos" : "objeto";

    rows.push({ field: prefix + name, type: label, required: Boolean(options.required), notes });
    if (nested) rows.push(...describe(nested, `${prefix}${name}.`));
  });
  return rows;
}

function table(rows: Row[]) {
  const head = "| Campo | Tipo | Obligatorio | Detalle |\n|---|---|:--:|---|";
  const body = rows.map(r =>
    `| \`${r.field}\` | ${r.type} | ${r.required ? "sí" : "—"} | ${r.notes.join(" · ") || "—"} |`
  ).join("\n");
  return `${head}\n${body}`;
}

const extras = [
  ["User", User, "Usuarios del sistema y sus permisos."],
  ["AuditLog", AuditLog, "Registro de auditoría: quién cambió qué y cuándo."],
  ["Counter", Counter, "Contadores para numeración correlativa (hoy: cotizaciones)."],
] as const;

const parts: string[] = [
  "# Esquema de la base de datos",
  "",
  "> ⚠️ **Documento generado.** No lo edites a mano: se sobrescribe.",
  "> Se produce leyendo los modelos reales de `src/lib/models.ts`, así que refleja",
  "> exactamente lo que la base guarda hoy.",
  ">",
  "> Regenerar con:",
  ">",
  "> ```bash",
  "> pnpm docs:schema",
  "> ```",
  "",
  `Generado el ${new Date().toISOString().slice(0, 10)} · ${entities.length + extras.length} colecciones.`,
  "",
  "Para el modelo de negocio *deseado* — lo que el cliente pidió y todavía no existe —",
  "ver [[cotizador-cascada]], [[liquidacion-quincenal]] y [[certificado-obra]].",
  "",
  "---",
  "",
  "## Módulos del sistema",
  "",
];

for (const entity of entities) {
  const model = modelByEntity[entity];
  parts.push(`### ${entityLabels[entity]}`, "", `Colección \`${model.collection.name}\` · entidad \`${entity}\``, "");
  parts.push(table(describe(model.schema)), "");
}

parts.push("---", "", "## Colecciones internas", "");
for (const [name, model, note] of extras) {
  parts.push(`### ${name}`, "", `${note} Colección \`${model.collection.name}\`.`, "");
  parts.push(table(describe(model.schema)), "");
}

writeFileSync(OUT, parts.join("\n"), "utf8");
console.log(`Escrito ${OUT} (${entities.length + extras.length} colecciones)`);
process.exit(0);
