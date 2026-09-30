import { describe, expect, it } from "vitest";
import { calcularIva } from "../src/iva.js";

/** Casos con valores exactos: subtotal $1.000,00 (100.000 centavos). */
describe("calcularIva", () => {
  it("21% de $1.000,00 → $210,00", () => {
    expect(calcularIva(100_000n, "21")).toBe(21_000n);
  });

  it("10,5% de $1.000,00 → $105,00", () => {
    expect(calcularIva(100_000n, "10_5")).toBe(10_500n);
  });

  it("27% de $1.000,00 → $270,00", () => {
    expect(calcularIva(100_000n, "27")).toBe(27_000n);
  });

  it("0% → $0,00", () => {
    expect(calcularIva(100_000n, "0")).toBe(0n);
  });

  it("exento → $0,00", () => {
    expect(calcularIva(100_000n, "exento")).toBe(0n);
  });

  it("no gravado → $0,00", () => {
    expect(calcularIva(100_000n, "no_gravado")).toBe(0n);
  });

  it("redondea al centavo (10,5% de $333,33 → $35,00)", () => {
    // 33.333 * 105 / 1000 = 3499,965 → redondeo comercial → 3500.
    expect(calcularIva(33_333n, "10_5")).toBe(3_500n);
  });
});
