import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Types } from "mongoose";
import { User } from "./models";
import { mailConfigured, sendMail } from "./mailer";
import { roleLabels, type Role } from "./constants";

/*
 * Invitaciones y cambio de contraseña. Quien crea la cuenta nunca elige la
 * contraseña: al usuario le llega un link por correo, entra y la elige él.
 * El mismo link sirve después para que gerencia le mande a alguien un
 * "cambiá tu contraseña" si se la olvidó.
 *
 * El token viaja sólo en el link; en la base queda su hash. Se usa una vez:
 * al elegir la contraseña se borra.
 */

export type InviteKind = "invite" | "reset";

const TTL_HOURS: Record<InviteKind, number> = { invite: 7 * 24, reset: 24 };

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function appUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

function expiryText(kind: InviteKind) {
  return kind === "invite" ? "7 días" : "24 horas";
}

/** El correo: texto plano para cualquier cliente y una versión con el botón. */
function inviteEmail(user: { name: string; email: string; role: Role }, link: string, kind: InviteKind) {
  const first = user.name.split(" ")[0] || user.name;
  const subject = kind === "invite" ? "Tu acceso a Pino Gestión: creá tu contraseña" : "Pino Gestión: link para cambiar tu contraseña";
  const intro = kind === "invite"
    ? `Te crearon una cuenta en Pino Gestión, el sistema de Pino Soluciones Técnicas, con el rol ${roleLabels[user.role]}.`
    : "Pidieron un cambio de contraseña para tu cuenta de Pino Gestión.";
  const action = kind === "invite" ? "Creá tu contraseña" : "Elegí una contraseña nueva";
  const text = [
    `Hola ${first}:`, "", intro, "",
    `${action} entrando a este link (vence en ${expiryText(kind)}):`, link, "",
    `Después ingresás con tu correo (${user.email}) y esa contraseña.`, "",
    "Si no esperabas este correo, ignoralo.",
  ].join("\n");
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f3f6fa;font-family:Segoe UI,Arial,sans-serif;color:#172235">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #dfe5ec">
<tr><td style="background:#00305b;padding:22px 28px;border-bottom:4px solid #e00010"><b style="color:#fff;font-size:18px;letter-spacing:.02em">PINO SOLUCIONES TÉCNICAS</b><br><span style="color:#cfe0ef;font-size:13px">Pino Gestión</span></td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 14px;font-size:15px">Hola ${escapeHtml(first)}:</p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.55">${escapeHtml(intro)}</p>
<p style="margin:0 0 26px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:13px 22px;border-radius:10px;background:#00305b;color:#fff;font-weight:700;text-decoration:none">${action}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#697386;line-height:1.5">El link vence en ${expiryText(kind)} y sirve una sola vez. Después ingresás con tu correo (<b>${escapeHtml(user.email)}</b>) y esa contraseña.</p>
<p style="margin:0 0 20px;font-size:12px;color:#8993a4;word-break:break-all">Si el botón no funciona, copiá este link en el navegador:<br>${escapeHtml(link)}</p>
<p style="margin:0;font-size:12px;color:#8993a4">Si no esperabas este correo, ignoralo.</p>
</td></tr></table></body></html>`;
  return { to: user.email, subject, text, html };
}

export type InviteResult = { link: string; sent: boolean; error: string; expiresAt: Date; kind: InviteKind };

/**
 * Genera un link nuevo (el anterior deja de servir) y lo manda por correo. Si
 * el correo no sale, igual devuelve el link: gerencia lo puede copiar y
 * mandar por WhatsApp.
 */
export async function issueInvite(user: { _id: Types.ObjectId | string; name: string; email: string; role: Role }, kind: InviteKind): Promise<InviteResult> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_HOURS[kind] * 60 * 60 * 1000);
  await User.updateOne({ _id: user._id }, { $set: { inviteTokenHash: hashToken(token), inviteExpiresAt: expiresAt, inviteKind: kind, invitedAt: new Date() } });
  const link = `${appUrl()}/activar?token=${token}`;
  if (!mailConfigured()) return { link, sent: false, error: "El envío de correos todavía no está configurado en el servidor.", expiresAt, kind };
  try {
    await sendMail(inviteEmail(user, link, kind));
    return { link, sent: true, error: "", expiresAt, kind };
  } catch (problem) {
    console.error("No se pudo enviar la invitación:", problem instanceof Error ? problem.message : problem);
    return { link, sent: false, error: "El servidor de correo rechazó el envío. Revisá la configuración SMTP.", expiresAt, kind };
  }
}

/** La cuenta a la que pertenece un link, si el link todavía sirve. */
export async function userForToken(token: string) {
  if (!token || token.length < 20 || token.length > 200) return null;
  return User.findOne({ inviteTokenHash: hashToken(token), inviteExpiresAt: { $gt: new Date() }, active: true })
    .select("name email role inviteKind").lean() as Promise<{ _id: Types.ObjectId; name: string; email: string; role: Role; inviteKind?: InviteKind } | null>;
}
