import { describe, expect, it } from "vitest";
import { bajoMinimo, diferenciaInventario } from "../src/inventario.js";

/** Sistema 120 bolsas, contado 115 → ajuste −5 × $ 11.000 = −$ 55.000. */
describe("diferenciaInventario", () => {
  it("sistema 120, contado 115, costo $ 11.000 → −5 unidades, −$ 55.000", () => {
    const d = diferenciaInventario("120", "115", 1_100_000n); // $ 11.000 en centavos
    expect(d.cantidad).toBe("-5.0000");
    expect(d.valor).toBe(-5_500_000n); // −$ 55.000
  });

  it("sin diferencia → 0", () => {
    const d = diferenciaInventario("120", "120", 1_100_000n);
    expect(d.cantidad).toBe("0.0000");
    expect(d.valor).toBe(0n);
  });

  it("sobrante: sistema 120, contado 130 → +10, +$ 110.000", () => {
    const d = diferenciaInventario("120", "130", 1_100_000n);
    expect(d.cantidad).toBe("10.0000");
    expect(d.valor).toBe(11_000_000n);
  });
});

describe("bajoMinimo", () => {
  it("punto de reposición 50, stock 45 → true", () => {
    expect(bajoMinimo("45", "50")).toBe(true);
  });

  it("stock 55, punto 50 → false", () => {
    expect(bajoMinimo("55", "50")).toBe(false);
  });

  it("igual al punto → false (todavía no está bajo mínimo)", () => {
    expect(bajoMinimo("50", "50")).toBe(false);
  });

  it("sin punto de reposición configurado → false", () => {
    expect(bajoMinimo("0", null)).toBe(false);
  });
});
