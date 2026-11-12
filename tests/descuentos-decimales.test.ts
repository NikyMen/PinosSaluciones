import { describe, expect, it } from "vitest";
import { decimalPointToComma, maskAmount, money, parseAmount } from "../src/lib/format";
import { purchaseLineNetCents, purchaseTotals } from "../src/lib/purchase-taxes";
import { invoiceLinesNetCents, lineNetCents } from "../src/lib/remito-billing";

// Lo que la persona ve al tipear en un campo de importe: la máscara aplicada al cambio.
const type = (previous: string, next: string) => maskAmount(decimalPointToComma(previous, next));

describe("importes con decimales (pedido de Administración, nov. 2026)", () => {
  it("todo importe se muestra con sus centavos: las diferencias de centavos no se esconden", () => {
    expect(money(46_165_000)).toMatch(/461\.650,00/);
    expect(money(46_164_996)).toMatch(/461\.649,96/);
    expect(money(46_165_000)).not.toBe(money(46_164_996));
  });

  it("el punto del teclado numérico escribe la coma decimal", () => {
    expect(type("1.234", "1.234.")).toBe("1.234,");
    expect(type("1.234,", "1.234,5")).toBe("1.234,5");
    expect(type("", ".")).toBe("0,");
    // Una segunda coma no hace nada.
    expect(type("12,5", "12,5.")).toBe("12,5");
    // Los dígitos siguen agrupando los miles.
    expect(type("1.234", "1.2345")).toBe("12.345");
    expect(parseAmount(type("230.649", "230.649.") + "96")).toBe(230649.96);
  });
});

describe("descuentos en pesos", () => {
  it("el renglón de compra resta su descuento y el IVA va sobre el neto con descuento", () => {
    expect(purchaseLineNetCents({ quantity: 3, unitCents: 10_000, discountCents: 5_000 })).toBe(25_000);
    expect(purchaseLineNetCents({ quantity: 1, unitCents: 10_000, discountCents: 50_000 })).toBe(0);
    const totals = purchaseTotals([{ totalCents: purchaseLineNetCents({ quantity: 2, unitCents: 100_00, discountCents: 20_00 }), vatPct: 21 }]);
    expect(totals).toMatchObject({ subtotalCents: 180_00, vatCents: 37_80, amountCents: 217_80 });
  });

  it("el renglón de un remito con descuento lo reparte en proporción al facturarlo en partes", () => {
    const line = { quantity: 4, unitPriceCents: 100_00, totalCents: 360_00 };
    expect(lineNetCents(line, 1)).toBe(90_00);
    expect(lineNetCents(line, 4)).toBe(360_00);
    // Sin descuento, como siempre: cantidad por precio.
    expect(lineNetCents({ quantity: 4, unitPriceCents: 100_00, totalCents: 400_00 }, 1)).toBe(100_00);
    // Las partes suman el total exacto.
    const remito = { _id: "r1", status: "parcial", lines: [{ ...line, invoicedQty: 3 }] };
    expect(invoiceLinesNetCents([remito], [{ remitoId: "r1", line: 0, quantity: 1 }])).toBe(360_00 - lineNetCents(line, 3));
  });
});
