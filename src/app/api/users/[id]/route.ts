import { isValidObjectId } from "mongoose";
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
  name: z.string().trim().min(2).optional(),
  email: z.email().trim().toLowerCase().optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  permissions: permissionsSchema.optional(),
});

type LeanUser = { _id: unknown; name: string; email: string; role: Role; active: boolean; permissions?: UserPermissions };

export async function PATCH(request: Request, context: RouteContext<"/api/users/[id]">) {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!isValidObjectId(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Datos o permisos inválidos" }, { status: 400 });
    if (id === session.userId && parsed.data.active === false) return Response.json({ error: "No podés desactivar tu propia cuenta" }, { status: 400 });
    await connectDB();
    const before = await User.findById(id).select("name email role active permissions").lean() as unknown as LeanUser | null;
    if (!before) return Response.json({ error: "Usuario no encontrado" }, { status: 404 });
    const role = parsed.data.role ?? before.role;
    const update = { ...parsed.data } as typeof parsed.data & { permissions?: UserPermissions };
    if (parsed.data.permissions) update.permissions = normalizePermissions(role, parsed.data.permissions);
    else if (parsed.data.role) update.permissions = defaultPermissionsForRole(role);
    const user = await User.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true }).select("name email role active permissions").lean() as unknown as LeanUser | null;
    if (!user) return Response.json({ error: "Usuario no encontrado" }, { status: 404 });
    const result = { ...user, _id: String(user._id), permissions: normalizePermissions(user.role, user.permissions) };
    await audit(session, "update", "users", id, before, result);
    return Response.json(result);
  } catch (error) { return apiError(error); }
}
