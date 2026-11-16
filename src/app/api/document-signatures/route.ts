import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { apiError, HttpError } from "@/lib/api";
import { DocumentSignature } from "@/lib/models";
import { COMPANY_KEYS } from "@/lib/companies";
import { audit } from "@/lib/audit";

const schema = z.object({ company: z.enum(COMPANY_KEYS), name: z.string().trim().min(1).max(65), title: z.string().trim().min(1).max(65) });

export async function GET() {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    await connectDB();
    return Response.json({ items: await DocumentSignature.find().select("company name title").lean() });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw new HttpError("Completá el nombre y el cargo de la firma");
    await connectDB();
    const filter = { company: parsed.data.company };
    const before = await DocumentSignature.findOne(filter).lean();
    const after = await DocumentSignature.findOneAndUpdate(filter, { $set: parsed.data }, { upsert: true, returnDocument: "after", runValidators: true }).lean();
    await audit(session, "update", "document_signatures", filter.company, before, after);
    return Response.json(after);
  } catch (error) { return apiError(error); }
}
