import { describe, expect, it } from "vitest";
import { esTransferenciaInterna, tcImplicito } from "../src/transferencias.js";

describe("tcImplicito", () => {
  it("transferencia origen/destino 1.535.000 / 1.000 → TC implícito 1535", () => {
    // 1.535.000,00 = 153.500.000 centavos; 1.000,00 = 100.000 centavos.
    expect(tcImplicito(153_500_000n, 100_000n)).toBe("1535.000000");
  });

  it("redondea medio hacia arriba al sexto decimal", () => {
    // 1/3 = 0,333333... → 0.333333 (no sube: el resto es < mitad del divisor).
    expect(tcImplicito(1n, 3n)).toBe("0.333333");
    // 2/3 = 0,666666... → sexto decimal exacto en 666667 (medio hacia arriba).
    expect(tcImplicito(2n, 3n)).toBe("0.666667");
  });

  it("importe destino 0 → tira (no hay TC posible)", () => {
    expect(() => tcImplicito(100n, 0n)).toThrow();
  });

  it("importe destino negativo → tira (mismo motivo que 0)", () => {
    expect(() => tcImplicito(100n, -1n)).toThrow();
  });
});

describe("esTransferenciaInterna", () => {
  it("la categoría de una transferencia queda afuera del cashflow", () => {
    expect(esTransferenciaInterna("transferencia_interna")).toBe(true);
    expect(esTransferenciaInterna("cobro_cuota")).toBe(false);
  });
});
