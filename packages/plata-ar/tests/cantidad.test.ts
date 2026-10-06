import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cantidadParaInput, formatearCantidad, normalizarCantidad } from "../src/index.ts";

describe("formatearCantidad", () => {
  it("lee el decimal de la base a la argentina, sin ceros de relleno", () => {
    expect(formatearCantidad("150.000")).toBe("150");
    expect(formatearCantidad("2.500")).toBe("2,5");
    expect(formatearCantidad("1500.000")).toBe("1.500");
    expect(formatearCantidad("1234567.125")).toBe("1.234.567,125");
    expect(formatearCantidad("0.0000")).toBe("0");
    expect(formatearCantidad("-0.000")).toBe("0");
    expect(formatearCantidad("-2.000")).toBe("-2");
    expect(formatearCantidad("007")).toBe("7");
    expect(formatearCantidad(" 8 ")).toBe("8");
  });
});

describe("cantidadParaInput", () => {
  it("coma decimal y sin miles", () => {
    expect(cantidadParaInput("130.000")).toBe("130");
    expect(cantidadParaInput("1500.000")).toBe("1500");
    expect(cantidadParaInput("2.500")).toBe("2,5");
  });
});

describe("normalizarCantidad", () => {
  it("sigue la convención argentina", () => {
    expect(normalizarCantidad("1.500")).toBe("1500");
    expect(normalizarCantidad("1.234.567,5")).toBe("1234567.5");
    expect(normalizarCantidad("2,5")).toBe("2.5");
    expect(normalizarCantidad("2.5")).toBe("2.5");
    expect(normalizarCantidad(" 1 30 ")).toBe("130");
    expect(normalizarCantidad("0,125")).toBe("0.125");
  });

  it("lo que precarga cantidadParaInput vuelve a leerse igual", () => {
    const decimal = fc
      .tuple(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.integer({ min: 0, max: 999 }))
      .map(([entero, milesimas]) => `${entero}.${String(milesimas).padStart(3, "0")}`);
    fc.assert(
      fc.property(decimal, (valor) => {
        const [entero, fraccion] = valor.split(".") as [string, string];
        const canonico = fraccion.replace(/0+$/, "") ? `${entero}.${fraccion.replace(/0+$/, "")}` : entero;
        expect(normalizarCantidad(cantidadParaInput(valor))).toBe(canonico);
      }),
    );
  });
});
