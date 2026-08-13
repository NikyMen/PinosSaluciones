import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage() {
  if (await getSession()) redirect("/app");
  return <main className="login-page"><section className="login-brand"><div className="brand-mark large">PS</div><div><p className="eyebrow">PINOS SOLUCIONES</p><h1>La gestión de cada obra, en un solo lugar.</h1><p>Ventas, ejecución y finanzas conectadas para decidir con información real.</p></div></section><section className="login-panel"><LoginForm /></section></main>;
}
