import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { entities, type Entity } from "@/lib/constants";
import { modelByEntity } from "@/lib/models";
import { entityConfig } from "@/lib/entity-config";
import { apiError } from "@/lib/api";
import { canRead } from "@/lib/permissions";
import { date, titleCase, todayIso } from "@/lib/format";

/**
 * Excel en español usa el punto y coma como separador de columnas y la coma como
 * decimal. Con la coma y los valores crudos, la planilla se abría toda en una
 * sola columna y los importes salían en centavos: de ahí los "números raros".
 */
const SEPARATOR = ";";

function csvCell(value: string) {
  return /[";\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Importe en pesos con coma decimal, sin símbolo: Excel lo reconoce como número. */
function amountCell(cents: unknown) {
  return (Number(cents || 0) / 100).toFixed(2).replace(".", ",");
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const value = new URL(request.url).searchParams.get("entity") || "clients";
    if (!entities.includes(value as Entity)) return Response.json({ error: "Módulo inválido" }, { status: 400 });
    const entity = value as Entity;
    if (!canRead(session, entity)) throw new Error("FORBIDDEN");

    await connectDB();
    const config = entityConfig[entity];
    // Se exportan los campos del formulario: los internos de Mongo no le sirven a nadie.
    const fields = config.fields.filter(field => field.type !== "file");
    const rows = await modelByEntity[entity].find().sort({ createdAt: -1 }).limit(10000).lean();

    // Las relaciones salen con el nombre del cliente/proveedor/obra, no con su ObjectId.
    const relationNames = new Map<string, Map<string, string>>();
    for (const related of new Set(fields.filter(field => field.relation).map(field => field.relation!))) {
      const docs = await modelByEntity[related].find().select("name title number code").limit(10000).lean() as Record<string, unknown>[];
      relationNames.set(related, new Map(docs.map(doc => [String(doc._id), String(doc.name || doc.title || doc.number || doc.code || "")])));
    }

    function cell(row: Record<string, unknown>, key: string) {
      const field = fields.find(candidate => candidate.key === key)!;
      const raw = row[key];
      if (raw === undefined || raw === null || raw === "") return "";
      if (field.type === "money") return amountCell(raw);
      if (field.type === "date") return date(String(raw));
      if (field.type === "relation") return relationNames.get(field.relation!)?.get(String(raw)) || "";
      if (field.type === "select") return titleCase(String(raw));
      if (Array.isArray(raw)) return raw.map(String).join(" / ");
      return String(raw);
    }

    const header = [...fields.map(field => field.label), "Creado el", "Última modificación"];
    const lines = [
      header.map(csvCell).join(SEPARATOR),
      ...rows.map(row => [
        ...fields.map(field => csvCell(cell(row as Record<string, unknown>, field.key))),
        csvCell(date((row as Record<string, unknown>).createdAt as string)),
        csvCell(date((row as Record<string, unknown>).updatedAt as string)),
      ].join(SEPARATOR)),
    ];

    // sep=; le avisa a Excel qué separador usar aunque la PC esté configurada en inglés.
    const csv = `﻿sep=${SEPARATOR}\r\n${lines.join("\r\n")}\r\n`;
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${entity}-${todayIso()}.csv"`,
      },
    });
  } catch (error) { return apiError(error); }
}
