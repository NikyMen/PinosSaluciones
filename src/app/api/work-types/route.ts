import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { WorkType } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { WORK_TYPE_UNITS } from "@/lib/work-type-labels";

type Row = { _id: unknown; name: string; unit?: string; rateCents?: number; active?: boolean };
const shape = (row: Row) => ({ _id: String(row._id), name: row.name, unit: row.unit || "hora", rateCents: Number(row.rateCents || 0), active: row.active !== false });

/** La tabla de tipos de trabajo con su tarifa. */
export async function GET() {
  try {
    const session = await requireSession();
    if (!canRead(session, "workers") && !canRead(session, "works")) throw new Error("FORBIDDEN");
    await connectDB();
    const rows = await WorkType.find().collation({ locale: "es" }).sort({ name: 1 }).lean() as Row[];
    return Response.json({ items: rows.map(shape) });
  } catch (error) { return apiError(error); }
}

const schema = z.object({
  items: z.array(z.object({
    _id: z.string().regex(/^[a-f\d]{24}$/i).optional(),
    name: z.string().trim().min(1, "Cada tipo de trabajo necesita un nombre").max(80),
    unit: z.enum(WORK_TYPE_UNITS).default("hora"),
    rateCents: z.coerce.number().int().min(0),
    active: z.boolean().default(true),
  })).max(200),
});

/** Guarda la tabla entera. Una tarifa que cambia queda en el historial del tipo. */
export async function PUT(request: Request) {
  try {
    const session = await requireSession();
    if (!canWrite(session, "workers")) throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Tarifas inválidas" }, { status: 400 });
    const names = parsed.data.items.map(item => item.name.toLowerCase());
    const repeated = names.find((name, index) => names.indexOf(name) !== index);
    if (repeated) return Response.json({ error: `"${repeated}" está dos veces` }, { status: 400 });
    await connectDB();
    const before = await WorkType.find().lean();
    for (const item of parsed.data.items) {
      const existing = item._id ? await WorkType.findById(item._id) : await WorkType.findOne({ name: item.name });
      if (!existing) { await WorkType.create({ ...item, history: [{ rateCents: item.rateCents, from: new Date(), userName: session.name }] }); continue; }
      if (existing.rateCents !== item.rateCents) existing.history.push({ rateCents: item.rateCents, from: new Date(), userName: session.name });
      existing.set({ name: item.name, unit: item.unit, rateCents: item.rateCents, active: item.active });
      await existing.save();
    }
    const after = await WorkType.find().collation({ locale: "es" }).sort({ name: 1 }).lean() as Row[];
    await audit(session, "update_work_types", "workers", null, before, after, request.headers.get("x-forwarded-for") || undefined);
    return Response.json({ items: after.map(shape) });
  } catch (error) { return apiError(error); }
}
