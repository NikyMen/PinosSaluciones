import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { connectDB } from "./db";
import { User } from "./models";
import type { Role } from "./constants";
import { normalizePermissions, type UserPermissions } from "./permissions";

const COOKIE = "pinos_session";
const secret = new TextEncoder().encode(process.env.SESSION_SECRET || "dev-secret-change-this-immediately");

export type Session = { userId: string; name: string; email: string; role: Role };
export type AuthorizedSession = Session & { permissions: UserPermissions };

export async function createSession(session: Session) {
  const token = await new SignJWT(session).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("8h").sign(secret);
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, secure: process.env.APP_URL?.startsWith("https://") === true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return payload as unknown as Session;
  } catch { return null; }
}

export async function requireSession(): Promise<AuthorizedSession> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  await connectDB();
  const active = await User.findOne({ _id: session.userId, active: true }).select("name email role permissions").lean();
  if (!active) throw new Error("UNAUTHORIZED");
  const user = active as unknown as { name: string; email: string; role: Role; permissions?: UserPermissions };
  return { userId: session.userId, name: user.name, email: user.email, role: user.role, permissions: normalizePermissions(user.role, user.permissions) };
}
