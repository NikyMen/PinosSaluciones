import Link from "next/link";
import { LinkIcon } from "lucide-react";
import { connectDB } from "@/lib/db";
import { roleLabels } from "@/lib/constants";
import { userForToken } from "@/lib/invitations";
import { ActivateForm } from "@/components/activate-form";
import { LoginBrand, LoginMobileBrand } from "@/components/login-brand";

/** Adonde lleva el link del correo: la persona elige su contraseña y entra. */
export default async function ActivatePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  await connectDB();
  const user = await userForToken(token);

  return (
    <main className="login-page">
      <LoginBrand />
      <section className="login-panel">
        <LoginMobileBrand />
        {user
          ? <ActivateForm token={token} name={user.name} email={user.email} role={roleLabels[user.role]} kind={user.inviteKind === "reset" ? "reset" : "invite"} />
          : <div className="login-form">
              <div className="login-form-heading">
                <span className="security-pill"><LinkIcon size={14} /> Link de acceso</span>
                <h1>Este link ya no sirve</h1>
                <p>Puede haber vencido o ya se usó para crear la contraseña. Pedile a gerencia que te mande uno nuevo, o ingresá si ya tenés tu contraseña.</p>
              </div>
              <Link className="primary-btn login-submit" href="/login">Ir a ingresar</Link>
            </div>}
        <p className="login-footer">Sistema de gestión integral</p>
      </section>
    </main>
  );
}
