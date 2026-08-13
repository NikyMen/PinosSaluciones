import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";
import { createSession } from "@/lib/auth";
import { apiError } from "@/lib/api";

const loginSchema = z.object({ email: z.email().trim().toLowerCase(), password: z.string().min(8).max(128) });

export async function POST(request: Request) {
  try {
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Datos de acceso inválidos" }, { status: 400 });
    await connectDB();
    const user = await User.findOne({ email: parsed.data.email, active: true }).select("+passwordHash").lean();
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return Response.json({ error: "Correo o contraseña incorrectos" }, { status: 401 });
    }
    await createSession({ userId: String(user._id), name: user.name, email: user.email, role: user.role });
    return Response.json({ ok: true, user: { name: user.name, role: user.role } });
  } catch (error) { return apiError(error); }
}
