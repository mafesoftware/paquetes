import { describe, expect, it } from "vitest";
import { aplicarFactor } from "../src/factor.ts";
import { ErrorPlata } from "../src/errores.ts";

describe("aplicarFactor", () => {
  it("el valor verbatim del brief: 10.000.000 x 1,06203057 -> 10.620.306", () => {
    // 10_000_000 x 1.06203057 = 10_620_305,7 -> redondeo comercial -> 10_620_306
    expect(aplicarFactor(10_000_000n, "1.06203057")).toBe(10_620_306n);
  });

  it("factor 1 no cambia el monto", () => {
    expect(aplicarFactor(123_456n, "1")).toBe(123_456n);
    expect(aplicarFactor(123_456n, "1.00000000")).toBe(123_456n);
  });

  it("factor menor a 1 reduce el monto", () => {
    expect(aplicarFactor(100_000_000n, "0.5")).toBe(50_000_000n);
  });

  it("factor negativo (ajuste que resulta en crédito)", () => {
    expect(aplicarFactor(100_000_000n, "-0.1")).toBe(-10_000_000n);
  });

  it("acepta menos de 8 decimales", () => {
    expect(aplicarFactor(1_000_000n, "1.1")).toBe(1_100_000n);
  });

  it("tira ErrorPlata con más de 8 decimales", () => {
    expect(() => aplicarFactor(1_000_000n, "1.123456789")).toThrow(ErrorPlata);
  });

  it("tira ErrorPlata con un factor que no es un decimal", () => {
    for (const factor of ["", "abc", "1.2.3", "1,5", "--1"]) {
      expect(() => aplicarFactor(1_000_000n, factor), `factor "${factor}"`).toThrow(ErrorPlata);
    }
  });

  it("el código del error es factor_invalido", () => {
    expect.assertions(1);
    try {
      aplicarFactor(1n, "no-es-un-numero");
    } catch (e) {
      expect((e as ErrorPlata).codigo).toBe("factor_invalido");
    }
  });
});
