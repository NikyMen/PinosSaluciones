import { describe, expect, it } from "vitest";
import { changes } from "@/components/record-history";

describe("historial de un material", () => {
  it("muestra movimientos, dueños y cantidades por depósito en palabras", () => {
    const before = { quantity: 15, qty_salon: 15, owners: { salon: { constructora: 15 } }, movements: [{ kind: "ingreso", quantity: 15, warehouse: "salon" }] };
    const after = { quantity: 13, qty_salon: 13, owners: { salon: { constructora: 13 } }, movements: [...before.movements, { kind: "egreso", quantity: 2, warehouse: "salon", destinationLabel: "Obra Centro", remito: "R-0042" }] };
    const list = changes("stock", { _id: "1", action: "update", before, after });
    const text = JSON.stringify(list);
    expect(text).not.toContain("[object Object]");
    expect(list.find(change => change.key === "movements")).toMatchObject({ label: "Movimiento nuevo", from: "1 movimiento", to: "Salida de 2 del Salón de Ventas a Obra Centro · remito R-0042" });
    expect(list.find(change => change.key === "owners")).toMatchObject({ label: "Empresa dueña", from: "Salón de Ventas: Constructora Pino 15", to: "Salón de Ventas: Constructora Pino 13" });
    expect(list.find(change => change.key === "qty_salon")).toMatchObject({ label: "Cantidad en Salón de Ventas", from: "15", to: "13" });
  });
});
