import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { connectDB } from "./db";
import { User } from "./models";
import type { Role } from "./constants";

const COOKIE = "pinos_session";
const secret = new TextEncoder().encode(process.env.SESSION_SECRET || "dev-secret-change-this-immediately");

export type Session = { userId: string; name: string; email: string; role: Role };

export async function createSession(session: Session) {
  const token = await new SignJWT(session).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("8h").sign(secret);
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
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

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  await connectDB();
  const active = await User.exists({ _id: session.userId, active: true });
  if (!active) throw new Error("UNAUTHORIZED");
  return session;
}
