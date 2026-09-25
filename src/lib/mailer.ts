import "server-only";
import nodemailer from "nodemailer";

/*
 * Envío de correos por SMTP. Sirve cualquier casilla que dé SMTP: la del
 * dominio, Gmail con contraseña de aplicación, Brevo, etc. Se configura con
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y MAIL_FROM en el .env; sin
 * SMTP_HOST no se manda nada y quien llama decide qué hacer (las
 * invitaciones, por ejemplo, muestran el link para copiarlo).
 */

export class MailNotConfigured extends Error {}

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim());
}

export async function sendMail({ to, subject, text, html }: { to: string; subject: string; text: string; html: string }) {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) throw new MailNotConfigured("El envío de correos no está configurado (falta SMTP_HOST en el .env)");
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER?.trim();
  const transport = nodemailer.createTransport({
    host, port,
    // 465 es SMTP con TLS directo; 587 arranca en claro y pasa a TLS (STARTTLS).
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: user ? { user, pass: process.env.SMTP_PASS || "" } : undefined,
    connectionTimeout: 15_000,
  });
  await transport.sendMail({ from: process.env.MAIL_FROM?.trim() || (user ? `"Pino Soluciones" <${user}>` : undefined), to, subject, text, html });
}
