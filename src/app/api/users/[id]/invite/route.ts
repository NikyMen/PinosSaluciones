import { isValidObjectId } from "mongoose";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import type { Role } from "@/lib/constants";
import { issueInvite } from "@/lib/invitations";

/**
 * Manda un link nuevo por correo. Si la cuenta todavía no tiene contraseña es
 * la invitación de nuevo; si ya tiene, es el link para cambiarla. El link
 * anterior deja de servir.
 */
export async function POST(request: Request, context: RouteContext<"/api/users/[id]/invite">) {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    await connectDB();
    const user = await User.findById(id).select("name email role active +passwordHash").lean() as { _id: string; name: string; email: string; role: Role; active: boolean; passwordHash?: string } | null;
    if (!user) return Response.json({ error: "Usuario no encontrado" }, { status: 404 });
    if (!user.active) return Response.json({ error: "La cuenta está inactiva: activala antes de mandarle el link" }, { status: 409 });
    const invite = await issueInvite(user, user.passwordHash ? "reset" : "invite");
    await audit(session, invite.kind === "invite" ? "resend_invite" : "send_password_reset", "users", id, null, { email: user.email, sent: invite.sent });
    return Response.json(invite);
  } catch (error) { return apiError(error); }
}
