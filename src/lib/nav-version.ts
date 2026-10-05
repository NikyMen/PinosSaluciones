/**
 * Qué menú lateral usa cada persona: "v1" es el de antes (Comercial, Obras,
 * Compras y stock, Finanzas) y "v2" el de los módulos de la especificación.
 * Se elige desde el menú del usuario y queda en una cookie del navegador, que
 * el layout lee en el servidor para que la barra no parpadee al cargar.
 */
export const NAV_COOKIE = "pino-nav";
export type NavVersion = "v1" | "v2";
export const navVersionOf = (value?: string): NavVersion => value === "v1" ? "v1" : "v2";

/** Guarda la elección en este navegador por un año. Sólo en el navegador. */
export function saveNavVersion(version: NavVersion) {
  document.cookie = `${NAV_COOKIE}=${version}; path=/; max-age=31536000; samesite=lax`;
}
