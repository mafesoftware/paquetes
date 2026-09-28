import { describe, expect, it } from "vitest";
import { ErrorIndices } from "../src/errores.js";
import { aBigIntConSigno, analizarDecimal, escalarA, formatearDecimal, sumarExacto } from "../src/decimal.js";

describe("analizarDecimal", () => {
  it("parsea un entero simple", () => {
    expect(analizarDecimal("7", "ctx")).toEqual({ negativo: false, valorAbs: 7n, escala: 0 });
  });

  it("parsea un decimal negativo", () => {
    expect(analizarDecimal("-12.345", "ctx")).toEqual({ negativo: true, valorAbs: 12345n, escala: 3 });
  });

  it('"-0" no cuenta como negativo (valorAbs 0)', () => {
    expect(analizarDecimal("-0.00", "ctx")).toEqual({ negativo: false, valorAbs: 0n, escala: 2 });
  });

  it("con espacios alrededor, se recorta", () => {
    expect(analizarDecimal("  3.5  ", "ctx")).toEqual({ negativo: false, valorAbs: 35n, escala: 1 });
  });

  it("texto no decimal tira ErrorIndices (valor_invalido)", () => {
    expect(() => analizarDecimal("abc", "mi-contexto")).toThrow(ErrorIndices);
    try {
      analizarDecimal("abc", "mi-contexto");
    } catch (e) {
      expect((e as ErrorIndices).codigo).toBe("valor_invalido");
      expect((e as ErrorIndices).message).toContain("mi-contexto");
    }
  });

  it("vacío, con coma, o con dos puntos: inválido", () => {
    expect(() => analizarDecimal("", "ctx")).toThrow(ErrorIndices);
    expect(() => analizarDecimal("1,5", "ctx")).toThrow(ErrorIndices);
    expect(() => analizarDecimal("1.2.3", "ctx")).toThrow(ErrorIndices);
  });
});

describe("aBigIntConSigno", () => {
  it("positivo y negativo", () => {
    expect(aBigIntConSigno({ negativo: false, valorAbs: 5n, escala: 0 })).toBe(5n);
    expect(aBigIntConSigno({ negativo: true, valorAbs: 5n, escala: 0 })).toBe(-5n);
  });
});

describe("formatearDecimal", () => {
  it("escala 0: sin punto decimal", () => {
    expect(formatearDecimal(123n, 0)).toBe("123");
    expect(formatearDecimal(-123n, 0)).toBe("-123");
  });

  it("recorta ceros de más, sin dejar punto colgando", () => {
    expect(formatearDecimal(12300n, 2)).toBe("123");
    expect(formatearDecimal(12340n, 2)).toBe("123.4");
  });

  it("rellena ceros a la izquierda si el valor es menor que la escala", () => {
    expect(formatearDecimal(5n, 3)).toBe("0.005");
  });

  it("negativo con decimales", () => {
    expect(formatearDecimal(-12340n, 2)).toBe("-123.4");
  });

  it("cero siempre da 0, nunca -0 ni vacío", () => {
    expect(formatearDecimal(0n, 2)).toBe("0");
  });
});

describe("escalarA", () => {
  it("multiplica por la potencia de 10 que falta", () => {
    expect(escalarA(5n, 0, 2)).toBe(500n);
  });

  it("misma escala: no cambia", () => {
    expect(escalarA(5n, 2, 2)).toBe(5n);
  });

  it("hasta < desde: tira (bug de quien llama, no un caso de negocio)", () => {
    expect(() => escalarA(5n, 3, 1)).toThrow();
  });
});

describe("sumarExacto", () => {
  it("suma dos decimales de igual escala", () => {
    expect(sumarExacto({ valor: 100n, escala: 2 }, { valor: 50n, escala: 2 })).toEqual({ valor: 150n, escala: 2 });
  });

  it("suma llevando el de menor escala a la mayor", () => {
    // 1.00 (escala 2) + 0.5 (escala 1) = 1.50
    expect(sumarExacto({ valor: 100n, escala: 2 }, { valor: 5n, escala: 1 })).toEqual({ valor: 150n, escala: 2 });
  });
});
