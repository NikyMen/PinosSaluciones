"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, TriangleAlert } from "lucide-react";

/** Dónde se recuerda el correo en este equipo (sólo el correo, nunca la contraseña). */
const REMEMBER_KEY = "pinos:login-email";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Con el correo recordado, el cursor arranca en la contraseña: es lo único que falta escribir.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      let saved = "";
      try { saved = window.localStorage.getItem(REMEMBER_KEY) || ""; } catch { /* sin almacenamiento: no se recuerda */ }
      if (saved) { setEmail(saved); passwordRef.current?.focus(); } else emailRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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
      if (!response.ok) {
        setLoading(false);
        setError(result.error || "No se pudo iniciar sesión");
        // Lo más probable es la contraseña: queda seleccionada para escribirla de nuevo.
        passwordRef.current?.focus();
        passwordRef.current?.select();
        return;
      }
      try {
        if (remember) window.localStorage.setItem(REMEMBER_KEY, String(data.get("email") || "").trim());
        else window.localStorage.removeItem(REMEMBER_KEY);
      } catch { /* sin almacenamiento: no se recuerda */ }
      // El botón sigue en "Ingresando…" hasta que abre el tablero.
      router.push("/app");
      router.refresh();
    } catch {
      setLoading(false);
      setError("No pudimos conectar con el sistema. Revisá la conexión e intentá de nuevo.");
    }
  }

  const watchCaps = (event: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState("CapsLock"));

  return (
    <form className="login-form" onSubmit={submit} noValidate={false}>
      <div className="login-form-heading">
        <h1>Ingresá a tu cuenta</h1>
        <p>Con el correo y la contraseña que usás en Pino Gestión.</p>
      </div>

      <label>
        <span>Correo electrónico</span>
        <div className="input-icon">
          <Mail size={19} aria-hidden="true" />
          <input ref={emailRef} name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required
            placeholder="nombre@empresa.com" value={email} onChange={event => setEmail(event.target.value)} />
        </div>
      </label>

      <label>
        <span>Contraseña</span>
        <div className="input-icon">
          <LockKeyhole size={19} aria-hidden="true" />
          <input ref={passwordRef} name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required minLength={8}
            aria-describedby="login-caps" onKeyDown={watchCaps} onKeyUp={watchCaps} onBlur={() => setCapsLock(false)} />
          <button
            className="password-toggle"
            type="button"
            onClick={() => setShowPassword(value => !value)}
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <small id="login-caps" className="login-caps" aria-live="polite">{capsLock && <><TriangleAlert size={13} /> Tenés activado Bloq Mayús</>}</small>
      </label>

      <label className="login-remember">
        <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />
        <span>Recordar mi correo en este equipo</span>
      </label>

      <div className="login-message" role="alert">
        {error && <p className="form-error"><TriangleAlert size={15} /> {error}</p>}
      </div>

      <button className="primary-btn login-submit" disabled={loading}>
        {loading ? <><span className="button-spinner" /> Ingresando…</> : <>Ingresar <ArrowRight size={18} /></>}
      </button>
      <p className="login-help">¿No podés entrar o te olvidaste la contraseña? Pedile a Gerencia que te mande el link para crear una nueva.</p>
    </form>
  );
}
