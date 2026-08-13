"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";

export function LoginForm() {
  const router = useRouter(); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(""); const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: data.get("email"), password: data.get("password") }) });
    const result = await response.json(); setLoading(false);
    if (!response.ok) return setError(result.error || "No se pudo iniciar sesión");
    router.push("/app"); router.refresh();
  }
  return <form className="login-form" onSubmit={submit}><div><p className="eyebrow">ACCESO SEGURO</p><h2>Bienvenido</h2><p className="muted">Ingresá con tu cuenta de Pinos.</p></div><label>Correo<div className="input-icon"><Mail size={18}/><input name="email" type="email" autoComplete="email" required placeholder="nombre@pinos.com"/></div></label><label>Contraseña<div className="input-icon"><LockKeyhole size={18}/><input name="password" type="password" autoComplete="current-password" required minLength={8}/></div></label>{error && <p className="form-error">{error}</p>}<button className="primary-btn full" disabled={loading}>{loading ? "Ingresando…" : <>Ingresar <ArrowRight size={18}/></>}</button></form>;
}
