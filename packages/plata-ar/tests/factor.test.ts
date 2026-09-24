import { describe, expect, it } from "vitest";
import { aplicarFactor, factorEntre } from "../src/factor.ts";
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

describe("factorEntre (M12)", () => {
  it('el valor verbatim: factorEntre("3662.2", "3448.3") -> "1.06203057"', () => {
    expect(factorEntre("3662.2", "3448.3")).toBe("1.06203057");
  });

  it("compone con aplicarFactor y da el mismo resultado que el factor a mano", () => {
    expect(aplicarFactor(10_000_000n, factorEntre("3662.2", "3448.3"))).toBe(10_620_306n);
  });

  it("valorRef == valorBase da factor 1", () => {
    expect(factorEntre("100", "100")).toBe("1");
  });

  it("redondea comercial a 8 decimales (no trunca)", () => {
    expect(factorEntre("1", "3")).toBe("0.33333333");
  });

  it("valorBase <= 0 tira ErrorPlata (tc_no_positivo)", () => {
    expect(() => factorEntre("100", "0")).toThrow(ErrorPlata);
    expect(() => factorEntre("100", "-5")).toThrow(ErrorPlata);
    try {
      factorEntre("100", "0");
    } catch (e) {
      expect((e as ErrorPlata).codigo).toBe("tc_no_positivo");
    }
  });

  it("valorRef negativo da un factor negativo", () => {
    expect(factorEntre("-100", "50")).toBe("-2");
  });
});
