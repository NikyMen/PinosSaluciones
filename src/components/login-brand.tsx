import Image from "next/image";
import { FileCheck2, FileText, HandCoins, HardHat, PackageCheck } from "lucide-react";

/*
 * El panel de la marca de las pantallas de acceso (ingresar y crear la
 * contraseña). Muestra lo que el sistema hace de punta a punta: el hilo de
 * documentos de una obra, de la cotización al cobro, colgado de una cuerda
 * sobre una fachada (el trabajo en altura de la empresa). Es un ejemplo, no
 * datos reales.
 */
const thread = [
  { icon: FileText, step: "Cotización", detail: "Aprobada por Gerencia" },
  { icon: HardHat, step: "Obra", detail: "Planificada: fechas y personal" },
  { icon: PackageCheck, step: "Compras y remitos", detail: "Material entregado en obra" },
  { icon: FileCheck2, step: "Factura", detail: "Emitida en ARCA, con CAE" },
  { icon: HandCoins, step: "Cobro", detail: "Recibo y saldo al día" },
];

export function LoginBrand() {
  return <section className="login-brand" aria-label="Pino Soluciones Técnicas">
    <div className="login-facade" aria-hidden="true" />
    <header className="login-brand-copy">
      <span className="login-kicker">Pino Gestión</span>
      <h2>De la cotización al cobro, todo en un mismo hilo.</h2>
      <p>Obras, compras, stock, ventas y tesorería conectados, para saber en qué está cada trabajo sin preguntar.</p>
    </header>

    <ol className="login-thread" aria-label="El recorrido de una obra en el sistema">
      {thread.map(({ icon: Icon, step, detail }) => <li key={step}>
        <span className="login-thread-node"><Icon size={17} /></span>
        <span className="login-thread-text"><b>{step}</b><small>{detail}</small></span>
      </li>)}
    </ol>

    <footer className="login-brand-foot">Pino Soluciones Técnicas · Corrientes, Argentina</footer>
  </section>;
}

/** El logo con el nombre, arriba del formulario. */
export function LoginMobileBrand() {
  return <div className="login-mobile-brand">
    <Image src="/brand/pino-logo.png" width={52} height={52} alt="Logo de Pino Soluciones Técnicas" priority />
    <span><b>Pino</b><small>Soluciones Técnicas</small></span>
  </div>;
}
