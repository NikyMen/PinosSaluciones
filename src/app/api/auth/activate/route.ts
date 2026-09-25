import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";
import { createSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { userForToken } from "@/lib/invitations";

const schema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8, "La contraseña tiene que tener al menos 8 caracteres").max(128, "La contraseña es demasiado larga"),
});

/**
 * La persona elige su contraseña desde el link del correo. El link se usa una
 * sola vez: se borra al guardar la contraseña, y la sesión queda iniciada.
 */
export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Datos inválidos" }, { status: 400 });
    await connectDB();
    const user = await userForToken(parsed.data.token);
    if (!user) return Response.json({ error: "El link no es válido o ya venció. Pedile a gerencia que te mande uno nuevo." }, { status: 410 });
    await User.updateOne({ _id: user._id }, {
      $set: { passwordHash: await bcrypt.hash(parsed.data.password, 12), passwordSetAt: new Date() },
      $unset: { inviteTokenHash: 1, inviteExpiresAt: 1, inviteKind: 1 },
    });
    const session = { userId: String(user._id), name: user.name, email: user.email, role: user.role };
    await audit(session, user.inviteKind === "reset" ? "password_reset" : "activate", "users", user._id, null, { email: user.email }, request.headers.get("x-forwarded-for") || undefined);
    await createSession(session);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
