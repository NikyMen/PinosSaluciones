"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole } from "lucide-react";

/** Elegir la contraseña desde el link de invitación. Al guardarla, la sesión queda iniciada. */
export function ActivateForm({ token, name, email, role, kind }: { token: string; name: string; email: string; role: string; kind: "invite" | "reset" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const first = name.split(" ")[0] || name;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") || "");
    if (password.length < 8) return setError("La contraseña tiene que tener al menos 8 caracteres");
    if (password !== String(data.get("confirm") || "")) return setError("Las dos contraseñas no coinciden");
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const result = await response.json();
      if (!response.ok) return setError(result.error || "No se pudo guardar la contraseña");
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
        <span className="security-pill"><KeyRound size={14} /> {kind === "invite" ? "Activá tu cuenta" : "Cambio de contraseña"}</span>
        <h1>{kind === "invite" ? `Hola, ${first}` : "Contraseña nueva"}</h1>
        <p>{kind === "invite" ? <>Creá tu contraseña para entrar a Pino Gestión como <b>{role}</b>.</> : "Elegí una contraseña nueva para tu cuenta."} Vas a ingresar con <b>{email}</b>.</p>
      </div>

      <label>
        <span>Contraseña</span>
        <div className="input-icon">
          <LockKeyhole size={19} aria-hidden="true" />
          <input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} autoFocus placeholder="Al menos 8 caracteres" />
          <button className="password-toggle" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </label>

      <label>
        <span>Repetila</span>
        <div className="input-icon">
          <LockKeyhole size={19} aria-hidden="true" />
          <input name="confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} />
        </div>
      </label>

      <div className="login-message" aria-live="polite">
        {error && <p className="form-error">{error}</p>}
      </div>

      <button className="primary-btn login-submit" disabled={loading}>
        {loading ? <><span className="button-spinner" /> Guardando…</> : <>{kind === "invite" ? "Crear contraseña y entrar" : "Guardar y entrar"} <ArrowRight size={18} /></>}
      </button>
      <p className="login-help">El link sirve una sola vez. Después ingresás con tu correo y esta contraseña.</p>
    </form>
  );
}
