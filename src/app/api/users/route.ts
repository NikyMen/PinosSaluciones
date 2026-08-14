import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";
import { entities, ROLES, viewSections, type Role } from "@/lib/constants";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { defaultPermissionsForRole, normalizePermissions, type UserPermissions } from "@/lib/permissions";

const permissionsSchema = z.object({
  view: z.array(z.enum(viewSections)),
  edit: z.array(z.enum(entities)),
}).superRefine((permissions, context) => {
  for (const entity of permissions.edit) {
    if (!permissions.view.includes(entity)) context.addIssue({ code: "custom", path: ["edit"], message: "Para editar una sección también debe poder verla" });
  }
});

const schema = z.object({
  name: z.string().trim().min(2),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8),
  role: z.enum(ROLES),
  permissions: permissionsSchema.optional(),
});

type LeanUser = { _id: unknown; name: string; email: string; role: Role; active: boolean; createdAt?: Date; permissions?: UserPermissions };

function publicUser(user: LeanUser) {
  return { _id: String(user._id), name: user.name, email: user.email, role: user.role, active: user.active, createdAt: user.createdAt, permissions: normalizePermissions(user.role, user.permissions) };
}

export async function GET() {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    await connectDB();
    const users = await User.find().select("name email role active permissions createdAt").sort({ name: 1 }).lean();
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
    const { password, ...data } = parsed.data;
    const permissions = normalizePermissions(data.role, data.permissions ?? defaultPermissionsForRole(data.role));
    const user = await User.create({ ...data, permissions, passwordHash: await bcrypt.hash(password, 12), active: true });
    await audit(session, "create", "users", user._id, null, { name: user.name, email: user.email, role: user.role, permissions });
    return Response.json(publicUser(user.toObject() as unknown as LeanUser), { status: 201 });
  } catch (error) { return apiError(error); }
}
