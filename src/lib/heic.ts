import convert from "heic-convert";

/*
 * Las fotos del iPhone vienen en HEIC, que Chrome y Edge no muestran. Se
 * reconocen por el contenido y no por el nombre: a veces llegan con extensión
 * .jpg o .png (renombradas a mano o por el celular) y quedaban como imagen rota.
 */

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);

/** Un archivo HEIF empieza con la caja `ftyp` y su marca en los bytes 8 a 12. */
export function isHeif(content: Uint8Array) {
  if (content.length < 12) return false;
  const text = (start: number, end: number) => String.fromCharCode(...content.subarray(start, end));
  return text(4, 8) === "ftyp" && HEIF_BRANDS.has(text(8, 12));
}

/** Pasa una foto HEIC a JPEG. */
export async function heicToJpeg(content: Uint8Array) {
  return Buffer.from(await convert({ buffer: content, format: "JPEG", quality: 0.85 }));
}

/** Tipo de imagen según los primeros bytes, para servir bien un archivo con la extensión cambiada. */
export function sniffImageType(content: Uint8Array) {
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return "image/jpeg";
  if (content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4e && content[3] === 0x47) return "image/png";
  if (content.length >= 12 && String.fromCharCode(...content.subarray(0, 4)) === "RIFF" && String.fromCharCode(...content.subarray(8, 12)) === "WEBP") return "image/webp";
  if (String.fromCharCode(...content.subarray(0, 4)) === "GIF8") return "image/gif";
  return undefined;
}
