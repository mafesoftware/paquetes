import { describe, expect, it } from "vitest";
import { compararCantidades, menorCantidad, multiplicar, porcentajeDe, restarCantidades, sumarCantidades } from "../src/cantidad.js";

describe("multiplicar", () => {
  it("200 × $ 12.000 (centavos) = $ 2.400.000,00", () => {
    expect(multiplicar("200", 1_200_000n)).toBe(240_000_000n);
  });

  it("redondea comercialmente (medio hacia arriba) al final", () => {
    expect(multiplicar("0.3333", 3n)).toBe(1n); // 0.3333 × 3 = 0.9999 → redondea a 1
  });
});

describe("sumarCantidades / restarCantidades", () => {
  it("suma preservando 4 decimales", () => {
    expect(sumarCantidades(["10.5", "0.25"])).toBe("10.7500");
  });

  it("resta: 1000 − 850 = 150", () => {
    expect(restarCantidades("1000", "850")).toBe("150.0000");
  });

  it("resta con resultado negativo", () => {
    expect(restarCantidades("10", "15")).toBe("-5.0000");
  });
});

describe("compararCantidades / menorCantidad", () => {
  it("compara signo de a - b", () => {
    expect(compararCantidades("10", "5")).toBe(1);
    expect(compararCantidades("5", "10")).toBe(-1);
    expect(compararCantidades("5", "5")).toBe(0);
  });

  it("menorCantidad devuelve la más chica", () => {
    expect(menorCantidad("120", "100")).toBe("100");
    expect(menorCantidad("100", "120")).toBe("100");
  });
});

describe("porcentajeDe", () => {
  it("(parte / total) × 100 con 4 decimales", () => {
    expect(porcentajeDe("850", "1000")).toBe("85.0000");
  });

  it("total 0 → 0.0000 (no divide por cero)", () => {
    expect(porcentajeDe("500", "0")).toBe("0.0000");
  });
});

describe("formato inválido", () => {
  it("una cantidad que no es un decimal de hasta 4 decimales tira error", () => {
    expect(() => multiplicar("abc", 1n)).toThrow(/cantidad inválida/);
  });

  it("más de 4 decimales también tira error", () => {
    expect(() => sumarCantidades(["1.23456"])).toThrow(/cantidad inválida/);
  });
});

describe("restarCantidades con b ya negativo", () => {
  it("resta un negativo es sumar: 10 − (−5) = 15", () => {
    expect(restarCantidades("10", "-5")).toBe("15.0000");
  });
});
