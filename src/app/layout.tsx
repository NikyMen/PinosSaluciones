import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Pino Soluciones Técnicas", template: "%s | Pino Soluciones Técnicas" },
  description: "Gestión integral de obras, ventas y administración",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
