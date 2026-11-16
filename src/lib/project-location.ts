export type ProjectLocation = { address?: string; mapUrl?: string; latitude?: number; longitude?: number };

export function safeGoogleMapsUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    const host = url.hostname;
    if (host === "maps.app.goo.gl" || (host === "goo.gl" && url.pathname.startsWith("/maps/"))) return url.href;
    if (/^(?:www\.|maps\.)?google\.(?:com|com\.ar)$/.test(host) && (url.pathname.startsWith("/maps") || host.startsWith("maps."))) return url.href;
  } catch { /* El formulario marca el enlace como inválido. */ }
  return "";
}

export function coordinatesFromMaps(value: string) {
  const safe = safeGoogleMapsUrl(value);
  if (!safe) return undefined;
  const url = new URL(safe);
  const parts = url.pathname.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
    || url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
    || (url.searchParams.get("query") || url.searchParams.get("q") || "").trim().match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  if (!parts) return undefined;
  const latitude = Number(parts[1]);
  const longitude = Number(parts[2]);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : undefined;
}

export function normalizeProjectLocation(value: unknown): ProjectLocation | null {
  if (!value || typeof value !== "object") return null;
  const { address, mapUrl, latitude, longitude } = value as ProjectLocation;
  const coords = typeof latitude === "number" && typeof longitude === "number" ? { latitude, longitude } : coordinatesFromMaps(mapUrl || "");
  if (!address && !mapUrl && !coords) return null;
  return { address: address || undefined, mapUrl: safeGoogleMapsUrl(mapUrl || "") || undefined, ...coords };
}

export function directionsHref(location?: ProjectLocation | null) {
  if (!location) return "";
  const safeUrl = safeGoogleMapsUrl(location.mapUrl || "");
  if (safeUrl) return safeUrl;
  const query = location.latitude !== undefined && location.longitude !== undefined ? `${location.latitude},${location.longitude}` : location.address;
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : "";
}
