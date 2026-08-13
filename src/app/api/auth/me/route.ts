import { getSession } from "@/lib/auth";
export async function GET() { const session = await getSession(); return session ? Response.json(session) : Response.json({ error: "Sin sesión" }, { status: 401 }); }
