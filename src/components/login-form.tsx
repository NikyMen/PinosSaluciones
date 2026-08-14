"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
      });
      const result = await response.json();
      if (!response.ok) return setError(result.error || "No se pudo iniciar sesión");
      router.push("/app");
      router.refresh();
    } catch {
      setError("No pudimos conectar con el sistema. Intentá nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <div className="login-form-heading">
        <span className="security-pill"><LockKeyhole size={14} /> Acceso seguro</span>
        <h1>Bienvenido</h1>
        <p>Ingresá a tu tablero de gestión.</p>
      </div>

      <label>
        <span>Correo electrónico</span>
        <div className="input-icon">
          <Mail size={19} aria-hidden="true" />
          <input name="email" type="email" autoComplete="email" required placeholder="nombre@pino.com" autoFocus />
        </div>
      </label>

      <label>
        <span>Contraseña</span>
        <div className="input-icon">
          <LockKeyhole size={19} aria-hidden="true" />
          <input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required minLength={8} />
          <button
            className="password-toggle"
            type="button"
            onClick={() => setShowPassword(value => !value)}
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </label>

      <div className="login-message" aria-live="polite">
        {error && <p className="form-error">{error}</p>}
      </div>

      <button className="primary-btn login-submit" disabled={loading}>
        {loading ? <><span className="button-spinner" /> Ingresando…</> : <>Ingresar al sistema <ArrowRight size={18} /></>}
      </button>
      <p className="login-help">Acceso exclusivo para personal autorizado.</p>
    </form>
  );
}
