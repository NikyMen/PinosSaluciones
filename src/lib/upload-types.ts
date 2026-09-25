/*
 * Qué archivos se pueden subir. Se decide por la extensión y no por el tipo que
 * informa el navegador: una foto HEIC del iPhone o un plano DWG muchas veces
 * llegan como "application/octet-stream". HTML y SVG quedan afuera a
 * propósito: se sirven desde el mismo dominio y podrían ejecutar código.
 */

type UploadType = { mime: string; /** Se puede mostrar en el navegador sin descargarlo. */ inline: boolean };

export const UPLOAD_TYPES: Record<string, UploadType> = {
  ".pdf": { mime: "application/pdf", inline: true },
  ".jpg": { mime: "image/jpeg", inline: true },
  ".jpeg": { mime: "image/jpeg", inline: true },
  ".png": { mime: "image/png", inline: true },
  ".webp": { mime: "image/webp", inline: true },
  ".gif": { mime: "image/gif", inline: true },
  ".heic": { mime: "image/heic", inline: false },
  ".heif": { mime: "image/heif", inline: false },
  ".doc": { mime: "application/msword", inline: false },
  ".docx": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false },
  ".xls": { mime: "application/vnd.ms-excel", inline: false },
  ".xlsx": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false },
  ".csv": { mime: "text/csv; charset=utf-8", inline: false },
  ".txt": { mime: "text/plain; charset=utf-8", inline: true },
  ".zip": { mime: "application/zip", inline: false },
  ".rar": { mime: "application/vnd.rar", inline: false },
  ".dwg": { mime: "application/acad", inline: false },
  ".dxf": { mime: "application/dxf", inline: false },
};

/** Para el `accept` de los campos de archivo. */
export const UPLOAD_ACCEPT = Object.keys(UPLOAD_TYPES).join(",");
export const UPLOAD_FORMATS_TEXT = "PDF, fotos, Word, Excel, planos DWG y más · hasta 10 MB";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function extensionOf(name: string) {
  const match = /\.[a-z0-9]+$/i.exec(name.trim());
  return match ? match[0].toLowerCase() : "";
}

/** Link para bajar el archivo con un nombre legible en vez del código con que se guarda. */
export function downloadHref(path: string, name: string) {
  return `${path}?download=${encodeURIComponent(name)}`;
}
