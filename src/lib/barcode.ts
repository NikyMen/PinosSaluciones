/*
 * Códigos de barras Code 128 (juego B) para las etiquetas de los materiales.
 * Es el formato que leen todos los lectores de mano y las cámaras, y acepta
 * letras, números y guiones: sirve para los códigos internos (PS-000123) y
 * para cualquier código de proveedor que no traiga su EAN impreso.
 *
 * Cada símbolo son 3 barras y 3 espacios; los dígitos del patrón son el ancho
 * de cada uno en módulos (siempre suman 11; el de parada, 13).
 */

export const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

const START_B = 104;
const STOP = 106;

/** Sólo caracteres imprimibles ASCII: lo que entra en el juego B. */
export function isCode128Text(value: string) {
  return value.length > 0 && [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) <= 126);
}

/** Los valores del código: inicio, datos, dígito verificador y parada. */
export function code128Values(text: string) {
  if (!isCode128Text(text)) throw new Error("El código tiene caracteres que no se pueden imprimir");
  const data = [...text].map(character => character.charCodeAt(0) - 32);
  const checksum = data.reduce((total, value, index) => total + value * (index + 1), START_B) % 103;
  return [START_B, ...data, checksum, STOP];
}

/** Ancho de cada barra y espacio, alternados y empezando por barra. */
export function code128Widths(text: string) {
  return code128Values(text).flatMap(value => [...CODE128_PATTERNS[value]].map(Number));
}

/**
 * El código como SVG. `moduleWidth` es el ancho de la barra más fina en las
 * unidades del SVG; se escala con CSS. Lleva los márgenes en blanco que el
 * lector necesita a los costados (10 módulos).
 */
export function code128Svg(text: string, { height = 60, moduleWidth = 2, quiet = 10 } = {}) {
  const widths = code128Widths(text);
  const total = widths.reduce((sum, width) => sum + width, 0) + quiet * 2;
  let x = quiet;
  const bars: string[] = [];
  widths.forEach((width, index) => {
    if (index % 2 === 0) bars.push(`<rect x="${x * moduleWidth}" y="0" width="${width * moduleWidth}" height="${height}"/>`);
    x += width;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total * moduleWidth} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${bars.join("")}</g></svg>`;
}

/** Código interno para un material sin código de barras propio: PS-000123. */
export function internalBarcode(sequence: number) {
  return `PS-${String(sequence).padStart(6, "0")}`;
}

/** Lo que manda el lector puede venir con espacios o saltos de línea de más. */
export function cleanScannedCode(value: string) {
  return String(value || "").replace(/[\r\n\t]/g, "").trim().slice(0, 64);
}
