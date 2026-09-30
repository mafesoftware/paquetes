import { describe, expect, it } from "vitest";
import { prorratearPorPorcentaje, sumaCien } from "../src/prorrateo.js";

describe("prorratearPorPorcentaje", () => {
  it("33/33/34 de $100,00 (10.000 centavos) → Σ exacta, sin perder ni inventar un centavo", () => {
    const partes = prorratearPorPorcentaje(10_000n, ["33", "33", "34"]);
    expect(partes).toHaveLength(3);
    expect(partes.reduce((acc, p) => acc + p, 0n)).toBe(10_000n);
    expect(partes.every((p) => p > 0n)).toBe(true);
  });

  it("un total no divisible exacto (10.001 centavos) también reparte Σ exacta", () => {
    const partes = prorratearPorPorcentaje(10_001n, ["33", "33", "34"]);
    expect(partes.reduce((acc, p) => acc + p, 0n)).toBe(10_001n);
  });
});

describe("sumaCien", () => {
  it("33 + 33 + 34 = 100 → true", () => {
    expect(sumaCien(["33", "33", "34"])).toBe(true);
  });

  it("50 + 40 = 90 → false", () => {
    expect(sumaCien(["50", "40"])).toBe(false);
  });
});
