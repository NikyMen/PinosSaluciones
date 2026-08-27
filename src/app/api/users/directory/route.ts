import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";
import { apiError } from "@/lib/api";

/**
 * Quiénes hay en el equipo, para poder asignarles una tarea y para el filtro
 * por persona. Devuelve sólo nombre y área: el listado completo de usuarios,
 * con permisos y correos, sigue siendo cosa de gerencia (`/api/users`).
 */
export async function GET() {
  try {
    await requireSession();
    await connectDB();
    const users = await User.find({ active: true }).select("name role").sort({ name: 1 }).lean();
    return Response.json({ items: users.map(user => ({ _id: String(user._id), name: user.name, role: user.role })) });
  } catch (error) { return apiError(error); }
}
