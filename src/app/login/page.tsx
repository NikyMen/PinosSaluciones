import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
import { LoginBrand, LoginMobileBrand } from "@/components/login-brand";

export default async function LoginPage() {
  if (await getSession()) redirect("/app");

  return (
    <main className="login-page">
      <LoginBrand />
      <section className="login-panel">
        <LoginMobileBrand />
        <LoginForm />
        <p className="login-footer">Sistema de gestión integral</p>
      </section>
    </main>
  );
}
