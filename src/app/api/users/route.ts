import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";
import { entities, ROLES, viewSections, type Role } from "@/lib/constants";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { defaultPermissionsForRole, normalizePermissions, type UserPermissions } from "@/lib/permissions";
import { issueInvite } from "@/lib/invitations";

const permissionsSchema = z.object({
  view: z.array(z.enum(viewSections)),
  edit: z.array(z.enum(entities)),
}).superRefine((permissions, context) => {
  for (const entity of permissions.edit) {
    if (!permissions.view.includes(entity)) context.addIssue({ code: "custom", path: ["edit"], message: "Para editar una sección también debe poder verla" });
  }
});

// Sin contraseña: la elige la persona desde el link que le llega por correo.
const schema = z.object({
  name: z.string().trim().min(2),
  email: z.email().trim().toLowerCase(),
  role: z.enum(ROLES),
  permissions: permissionsSchema.optional(),
});

type LeanUser = { _id: unknown; name: string; email: string; role: Role; active: boolean; createdAt?: Date; permissions?: UserPermissions; passwordHash?: string; inviteExpiresAt?: Date };

/** Lo que ve gerencia de cada cuenta. `pending`: todavía no eligió su contraseña. */
function publicUser(user: LeanUser) {
  return {
    _id: String(user._id), name: user.name, email: user.email, role: user.role, active: user.active, createdAt: user.createdAt,
    permissions: normalizePermissions(user.role, user.permissions),
    pending: !user.passwordHash, inviteExpiresAt: user.passwordHash ? null : user.inviteExpiresAt ?? null,
  };
}

export async function GET() {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    await connectDB();
    // El hash se lee sólo para saber si ya tiene contraseña; no sale de acá.
    const users = await User.find().select("name email role active permissions createdAt inviteExpiresAt +passwordHash").sort({ name: 1 }).lean();
    return Response.json({ items: users.map(user => publicUser(user as unknown as LeanUser)) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Datos inválidos. Revisá la cuenta y sus permisos." }, { status: 400 });
    await connectDB();
    if (await User.exists({ email: parsed.data.email })) return Response.json({ error: "Ya hay un usuario con ese correo" }, { status: 409 });
    const permissions = normalizePermissions(parsed.data.role, parsed.data.permissions ?? defaultPermissionsForRole(parsed.data.role));
    const user = await User.create({ ...parsed.data, permissions, active: true });
    const invite = await issueInvite(user, "invite");
    await audit(session, "create", "users", user._id, null, { name: user.name, email: user.email, role: user.role, permissions, inviteSent: invite.sent });
    return Response.json({ ...publicUser({ ...user.toObject(), inviteExpiresAt: invite.expiresAt } as unknown as LeanUser), invite }, { status: 201 });
  } catch (error) { return apiError(error); }
}
