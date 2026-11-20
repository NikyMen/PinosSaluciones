/*
 * Cómo se reconoce un material de Stock en la lista de un proveedor, para
 * tomar su precio final al consumidor (Protex lo informa con IVA). Sin
 * imports del servidor: lo usan los modelos y src/lib/sale-prices.ts.
 *
 * - Por el código interno (`sku`) igual al código de la lista (sin importar
 *   mayúsculas ni espacios).
 * - O por el código base, antes del guion, para las variantes que Stock separa
 *   y la lista no: "JUE905-BIDON" y "JUE905-BOLSA" son el "JUE905" de la lista.
 * - Un material sin código no se cruza. Si el material tiene proveedor, tiene
 *   que ser el de la lista.
 */

export const listCode = (value: unknown) => String(value ?? "").trim().toUpperCase();

/** Los códigos con que se busca un material en la lista: el suyo y, si tiene guion, el de antes del guion. */
export function listCodesFor(sku: unknown) {
  const code = listCode(sku);
  if (!code) return [];
  const base = code.includes("-") ? code.split("-")[0].trim() : "";
  return base && base !== code ? [code, base] : [code];
}

/** El precio de venta sin IVA a partir del precio final con IVA de la lista. */
export const saleCentsFromGross = (grossCents: number) => Math.round(grossCents / 1.21);

export type ListPriceItem = { _id: unknown; supplierId: unknown; code?: string; name?: string; presentation?: string; consumerGrossCents?: number };

/**
 * El producto de la lista que corresponde a un material, o nada. Con dos
 * productos de distinto precio para el mismo código (dos proveedores), no se elige.
 */
export function matchListItem(stock: { sku?: unknown; supplierId?: unknown }, byCode: Map<string, ListPriceItem[]>) {
  for (const code of listCodesFor(stock.sku)) {
    const candidates = (byCode.get(code) || []).filter(item => !stock.supplierId || String(item.supplierId) === String(stock.supplierId));
    const prices = new Set(candidates.map(item => item.consumerGrossCents));
    if (candidates.length && prices.size === 1) return candidates[0];
    if (candidates.length) return null;
  }
  return null;
}

/** Arma el índice por código de los productos de lista con precio final. */
export function indexListItems(items: ListPriceItem[]) {
  const byCode = new Map<string, ListPriceItem[]>();
  for (const item of items) {
    const code = listCode(item.code);
    if (!code || !(Number(item.consumerGrossCents) > 0)) continue;
    byCode.set(code, [...(byCode.get(code) || []), item]);
  }
  return byCode;
}
