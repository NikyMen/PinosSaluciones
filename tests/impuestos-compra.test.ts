import { describe, expect, it } from "vitest";
import { purchaseTaxFields, purchaseTaxRows, purchaseTotals, storedPurchaseTaxes } from "../src/lib/purchase-taxes";

describe("impuestos de la solicitud de compra", () => {
  it("el total sale del neto, el IVA, las percepciones y el impuesto interno", () => {
    const totals = purchaseTotals([{ totalCents: 1_000_000_00 }], { vatPct: 21, perceptionVatPct: 3, perceptionIibbPct: 2, perceptionIibbProvPct: 1.5 });
    expect(totals).toMatchObject({
      subtotalCents: 1_000_000_00, vatCents: 210_000_00,
      perceptionVatCents: 30_000_00, perceptionIibbCents: 20_000_00, perceptionIibbProvCents: 15_000_00, perceptionsCents: 65_000_00,
      internalTaxCents: 0, amountCents: 1_275_000_00,
    });
  });

  it("cada renglón lleva su alícuota; el que no dice, la de la solicitud", () => {
    const totals = purchaseTotals([{ totalCents: 100_000_00 }, { totalCents: 50_000_00, vatPct: 10.5 }, { totalCents: 10_000_00, vatPct: 27 }], { vatPct: 21, internalTaxPct: 4 });
    expect(totals.vatByRate).toEqual([
      { pct: 10.5, baseCents: 50_000_00, vatCents: 5_250_00 },
      { pct: 21, baseCents: 100_000_00, vatCents: 21_000_00 },
      { pct: 27, baseCents: 10_000_00, vatCents: 2_700_00 },
    ]);
    // Las percepciones y el impuesto interno van sobre el neto total.
    expect(totals.internalTaxCents).toBe(6_400_00);
    expect(totals.amountCents).toBe(160_000_00 + 28_950_00 + 6_400_00);
    // Una alícuota que no es de las tres vale como la de la solicitud.
    expect(purchaseTotals([{ totalCents: 100_00, vatPct: 5 }], { vatPct: 27 }).vatCents).toBe(27_00);
  });

  it("guarda los porcentajes y los importes; una compra de antes vale al 21 % con el neto de su total", () => {
    expect(purchaseTaxFields([{ totalCents: 200_00 }], { vatPct: 10.5, perceptionIibbPct: 2 })).toMatchObject({ subtotalCents: 200_00, vatPct: 10.5, vatCents: 21_00, perceptionIibbCents: 4_00, perceptionVatPct: 0, amountCents: 225_00 });
    expect(storedPurchaseTaxes({ amountCents: 121_00 })).toMatchObject({ subtotalCents: 100_00, vatPct: 21, perceptionVatPct: 0, internalTaxPct: 0 });
    expect(purchaseTaxRows({ amountCents: 121_01 })).toEqual({ subtotalCents: 100_01, rows: [{ label: "IVA 21 %", cents: 21_00 }] });
    expect(purchaseTaxRows({ subtotalCents: 1_000_00, vatPct: 27, vatCents: 270_00, perceptionVatPct: 3, perceptionVatCents: 30_00, amountCents: 1_300_00 }).rows)
      .toEqual([{ label: "IVA 27 %", cents: 270_00 }, { label: "Percepción de IVA 3 %", cents: 30_00 }]);
  });
});
