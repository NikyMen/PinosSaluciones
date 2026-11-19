/*
 * Las cuentas de una venta por mostrador, iguales en la pantalla y en el
 * servidor (src/lib/counter-sales.ts): cada renglón es cantidad × precio sin
 * IVA menos su descuento en pesos; el neto es la suma; el IVA, el 21 % del
 * neto, como lo calcula la factura (prepareInvoice). La X no lleva IVA.
 */
export function counterTotals(voucherType: string, lines: Array<{ quantity: number; unitPriceCents: number; discountCents?: number }>) {
  const rows = lines.map(line => {
    const gross = Math.round(line.quantity * line.unitPriceCents);
    return { gross, totalCents: Math.max(0, gross - Number(line.discountCents || 0)) };
  });
  const netCents = rows.reduce((total, row) => total + row.totalCents, 0);
  const vatPct = voucherType === "factura_x" ? 0 : 21;
  const vatCents = Math.round(netCents * vatPct / 100);
  return { rows, netCents, vatPct, vatCents, amountCents: netCents + vatCents };
}

/** El precio con el 21 % de IVA, a partir del precio sin IVA. */
export function withVatCents(unitPriceCents: number) {
  return Math.round(unitPriceCents * 1.21);
}

/** El precio sin IVA a partir del precio con el 21 % de IVA (lo que se escribe en "Precio c/IVA"). */
export function withoutVatCents(priceWithVatCents: number) {
  return Math.round(priceWithVatCents / 1.21);
}
