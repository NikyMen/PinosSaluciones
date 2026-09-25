import Image from "next/image";
import { BarChart3, HardHat, ShieldCheck } from "lucide-react";

/** El panel de la marca de las pantallas de acceso (ingresar y crear la contraseña). */
export function LoginBrand() {
  return <section className="login-brand" aria-label="Pino Soluciones Técnicas">
    <div className="blueprint-grid" aria-hidden="true" />
    <header className="login-brand-header">
      <Image src="/brand/pino-logo.png" width={84} height={84} alt="Logo de Pino Soluciones Técnicas" priority />
      <div><b>Pino</b><span>Soluciones Técnicas</span></div>
    </header>

    <div className="login-brand-copy">
      <span className="location-pill">Corrientes, Argentina</span>
      <h2>Control total de cada obra, en un solo lugar.</h2>
      <p>Ventas, ejecución y finanzas conectadas para tomar mejores decisiones.</p>
    </div>

    <div className="login-feature-grid">
      <article><HardHat /><span><b>Obras</b><small>Seguimiento operativo</small></span></article>
      <article><BarChart3 /><span><b>Indicadores</b><small>Visión gerencial</small></span></article>
      <article><ShieldCheck /><span><b>Seguro</b><small>Acceso por roles</small></span></article>
    </div>
  </section>;
}

/** El logo chico que reemplaza al panel de la marca en el teléfono. */
export function LoginMobileBrand() {
  return <div className="login-mobile-brand">
    <Image src="/brand/pino-logo.png" width={68} height={68} alt="Logo de Pino Soluciones Técnicas" priority />
    <span><b>Pino</b><small>Soluciones Técnicas</small></span>
  </div>;
}
