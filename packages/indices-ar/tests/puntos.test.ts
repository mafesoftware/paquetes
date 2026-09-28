import { describe, expect, it } from "vitest";
import { ErrorIndices } from "../src/errores.js";
import { puntosIndice, saldoDesdePuntos } from "../src/puntos.js";

describe("puntosIndice", () => {
  it("caso exacto: 3.448.300 / 3448,3 = 1000 puntos", () => {
    expect(puntosIndice(3_448_300n, "3448.3")).toBe("1000");
  });

  it("caso con redondeo a 8 decimales", () => {
    expect(puntosIndice(10_000_000n, "3448.3")).toBe("2899.97970014");
  });

  it("saldo 0: 0 puntos", () => {
    expect(puntosIndice(0n, "3448.3")).toBe("0");
  });

  it("valorBase 0 o negativo tira ErrorIndices (indice_invalido)", () => {
    expect(() => puntosIndice(1_000_000n, "0")).toThrow(ErrorIndices);
    expect(() => puntosIndice(1_000_000n, "-10")).toThrow(ErrorIndices);
  });

  it("valorBase inválido tira ErrorIndices (valor_invalido, vía analizarDecimal)", () => {
    expect(() => puntosIndice(1_000_000n, "abc")).toThrow(ErrorIndices);
  });
});

describe("saldoDesdePuntos", () => {
  it("caso exacto: 1000 puntos a 3448,3 = 3.448.300 centavos", () => {
    expect(saldoDesdePuntos("1000", "3448.3")).toBe(3_448_300n);
  });

  it("es la vuelta (redondeada) de puntosIndice", () => {
    expect(saldoDesdePuntos("2899.97970014", "3448.3")).toBe(10_000_000n);
  });

  it("puntos negativos dan saldo negativo", () => {
    expect(saldoDesdePuntos("-1000", "3448.3")).toBe(-3_448_300n);
  });

  it("puntos y valor sin decimales: no hace falta redondear (rama escalaTotal === 0)", () => {
    expect(saldoDesdePuntos("5", "100")).toBe(500n);
  });

  it("valorActual 0 o negativo tira ErrorIndices (indice_invalido)", () => {
    expect(() => saldoDesdePuntos("1000", "0")).toThrow(ErrorIndices);
    expect(() => saldoDesdePuntos("1000", "-10")).toThrow(ErrorIndices);
  });
});
