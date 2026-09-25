import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { defaultPermissionsForRole } from "../src/lib/permissions";

/*
 * Alta de usuarios por invitación: la cuenta se crea sin contraseña, le llega
 * un link por correo, la persona elige la contraseña y entra. El correo y la
 * cookie de sesión están simulados; la base y las rutas son las reales.
 */

const session = { userId: new Types.ObjectId().toHexString(), name: "Gerente", email: "gerencia@test.local", role: "gerencia" as const, permissions: defaultPermissionsForRole("gerencia") };
const created: Array<{ email: string }> = [];
vi.mock("@/lib/auth", () => ({
  requireSession: async () => session,
  getSession: async () => session,
  createSession: async (value: { email: string }) => { created.push(value); },
}));

const mail = { configured: true, fail: false, sent: [] as Array<{ to: string; subject: string; text: string; html: string }> };
vi.mock("@/lib/mailer", () => ({
  mailConfigured: () => mail.configured,
  sendMail: async (message: { to: string; subject: string; text: string; html: string }) => {
    if (mail.fail) throw new Error("SMTP caído");
    mail.sent.push(message);
  },
}));

const { User } = await import("../src/lib/models");
const usersRoute = await import("../src/app/api/users/route");
const inviteRoute = await import("../src/app/api/users/[id]/invite/route");
const activateRoute = await import("../src/app/api/auth/activate/route");
const loginRoute = await import("../src/app/api/auth/login/route");

let server: MongoMemoryServer;
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const call = async (response: Response) => ({ status: response.status, body: await response.json() });
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const tokenFrom = (text: string) => /\/activar\?token=([\w-]+)/.exec(text)?.[1] || "";
const login = async (email: string, password: string) => call(await loginRoute.POST(new Request("http://test", json({ email, password }))));
const activate = async (token: string, password: string) => call(await activateRoute.POST(new Request("http://test", json({ token, password }))));

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("usuarios");
  process.env.APP_URL = "https://pino.test/";
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

beforeEach(() => { mail.configured = true; mail.fail = false; mail.sent.length = 0; created.length = 0; });

describe("alta de usuarios por invitación", () => {
  it("crea la cuenta sin contraseña, manda el link, y con el link elige la contraseña y entra", async () => {
    const response = await call(await usersRoute.POST(new Request("http://test", json({ name: "Lautaro Ruiz", email: "Lautaro@Pino.com", role: "compras" }))));
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ email: "lautaro@pino.com", pending: true, invite: { sent: true, kind: "invite", error: "" } });
    // Con todos los módulos para ver y los de su rol para editar.
    expect(response.body.permissions).toEqual(defaultPermissionsForRole("compras"));

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: "lautaro@pino.com", subject: "Tu acceso a Pino Gestión: creá tu contraseña" });
    expect(mail.sent[0].text).toContain("Hola Lautaro:");
    expect(mail.sent[0].text).toContain("https://pino.test/activar?token=");
    const token = tokenFrom(mail.sent[0].text);
    expect(response.body.invite.link).toBe(`https://pino.test/activar?token=${token}`);
    // En la base no queda el token, sólo su hash.
    const stored = await User.findOne({ email: "lautaro@pino.com" }).select("+inviteTokenHash +passwordHash").lean() as { inviteTokenHash?: string; passwordHash?: string };
    expect(stored.passwordHash).toBeUndefined();
    expect(stored.inviteTokenHash).toMatch(/^[a-f\d]{64}$/);
    expect(stored.inviteTokenHash).not.toContain(token);

    expect((await call(await usersRoute.POST(new Request("http://test", json({ name: "Otro", email: "lautaro@pino.com", role: "ventas" }))))).status).toBe(409);
    // Sin contraseña todavía no puede entrar, y se le dice por qué.
    const early = await login("lautaro@pino.com", "cualquiera123");
    expect(early.status).toBe(403);
    expect(early.body.error).toContain("link");

    const list = await call(await usersRoute.GET());
    const listed = list.body.items.find((user: { email: string }) => user.email === "lautaro@pino.com");
    expect(listed).toMatchObject({ pending: true });
    expect(listed.passwordHash).toBeUndefined();

    expect((await activate(token, "corta")).status).toBe(400);
    expect(await activate(token, "Obra2026!")).toEqual({ status: 200, body: { ok: true } });
    expect(created).toEqual([{ userId: String(listed._id), name: "Lautaro Ruiz", email: "lautaro@pino.com", role: "compras" }]);
    // El link sirve una sola vez.
    expect((await activate(token, "OtraClave2026")).status).toBe(410);
    expect((await login("lautaro@pino.com", "Obra2026!")).status).toBe(200);
    const after = await call(await usersRoute.GET());
    expect(after.body.items.find((user: { email: string }) => user.email === "lautaro@pino.com").pending).toBe(false);
  });

  it("gerencia manda un link para cambiar la contraseña; el anterior deja de servir", async () => {
    const user = await User.findOne({ email: "lautaro@pino.com" }).lean() as { _id: Types.ObjectId };
    const first = await call(await inviteRoute.POST(new Request("http://test", { method: "POST" }), params({ id: String(user._id) })));
    expect(first.body).toMatchObject({ sent: true, kind: "reset" });
    expect(mail.sent[0].subject).toBe("Pino Gestión: link para cambiar tu contraseña");
    const second = await call(await inviteRoute.POST(new Request("http://test", { method: "POST" }), params({ id: String(user._id) })));
    expect((await activate(tokenFrom(first.body.link), "NuevaClave1")).status).toBe(410);
    expect((await activate(tokenFrom(second.body.link), "NuevaClave1")).status).toBe(200);
    // Hasta usar el link, la contraseña vieja seguía; ahora vale la nueva.
    expect((await login("lautaro@pino.com", "Obra2026!")).status).toBe(401);
    expect((await login("lautaro@pino.com", "NuevaClave1")).status).toBe(200);
  });

  it("sin correo configurado (o si falla) la cuenta se crea igual y devuelve el link para mandarlo a mano", async () => {
    mail.configured = false;
    const unconfigured = await call(await usersRoute.POST(new Request("http://test", json({ name: "Fernando", email: "fernando@pino.com", role: "arquitecto" }))));
    expect(unconfigured.status).toBe(201);
    expect(unconfigured.body.invite).toMatchObject({ sent: false, error: "El envío de correos todavía no está configurado en el servidor." });
    expect(unconfigured.body.invite.link).toContain("/activar?token=");
    expect(mail.sent).toHaveLength(0);

    mail.configured = true;
    mail.fail = true;
    const failed = await call(await usersRoute.POST(new Request("http://test", json({ name: "Jorge", email: "jorge@pino.com", role: "gerencia" }))));
    expect(failed.body.invite).toMatchObject({ sent: false });
    expect(failed.body.invite.error).toContain("SMTP");
    // El link que se muestra funciona igual que el del correo.
    expect((await activate(tokenFrom(failed.body.invite.link), "Jorge2026!")).status).toBe(200);
  });

  it("un link vencido no sirve y a una cuenta inactiva no se le manda", async () => {
    const response = await call(await usersRoute.POST(new Request("http://test", json({ name: "Vencido", email: "vencido@pino.com", role: "ventas" }))));
    await User.updateOne({ email: "vencido@pino.com" }, { $set: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    expect((await activate(tokenFrom(response.body.invite.link), "Clave12345")).status).toBe(410);

    await User.updateOne({ email: "vencido@pino.com" }, { $set: { active: false } });
    const inactive = await call(await inviteRoute.POST(new Request("http://test", { method: "POST" }), params({ id: response.body._id })));
    expect(inactive.status).toBe(409);
  });
});
