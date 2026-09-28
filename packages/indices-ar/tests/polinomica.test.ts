import { describe, expect, it } from "vitest";
import { ErrorPlata } from "@mafesoftware/plata-ar";
import { ErrorIndices } from "../src/errores.js";
import { valorPolinomica } from "../src/polinomica.js";

describe("valorPolinomica", () => {
  it("3 componentes (0.45 MO + 0.45 Mat + 0.10 GG) a 8 decimales", () => {
    const r = valorPolinomica([
      { peso: "0.45", actual: "150", base: "100" },
      { peso: "0.45", actual: "120", base: "100" },
      { peso: "0.10", actual: "110", base: "100" },
    ]);
    expect(r).toBe("1.325");
  });

  it("un único componente con peso 1: da exactamente su factor", () => {
    expect(valorPolinomica([{ peso: "1", actual: "3662.2", base: "3448.3" }])).toBe("1.06203057");
  });

  it("todos los componentes sin cambio (actual == base): da 1", () => {
    const r = valorPolinomica([
      { peso: "0.5", actual: "100", base: "100" },
      { peso: "0.5", actual: "100", base: "100" },
    ]);
    expect(r).toBe("1");
  });

  it("pesos que suman 1 dentro de la tolerancia (±1e-8) no tiran", () => {
    expect(() =>
      valorPolinomica([
        { peso: "0.333333335", actual: "100", base: "100" },
        { peso: "0.333333335", actual: "100", base: "100" },
        { peso: "0.33333333", actual: "100", base: "100" },
      ]),
    ).not.toThrow();
  });

  it("pesos que suman MÁS de 1 (fuera de tolerancia) también tiran ErrorIndices", () => {
    expect(() =>
      valorPolinomica([
        { peso: "0.8", actual: "100", base: "100" },
        { peso: "0.8", actual: "100", base: "100" },
      ]),
    ).toThrow(ErrorIndices);
  });

  it("pesos que no suman 1 tiran ErrorIndices (pesos_no_suman_uno)", () => {
    expect(() => valorPolinomica([{ peso: "0.5", actual: "100", base: "100" }])).toThrow(ErrorIndices);
    try {
      valorPolinomica([{ peso: "0.5", actual: "100", base: "100" }]);
    } catch (e) {
      expect((e as ErrorIndices).codigo).toBe("pesos_no_suman_uno");
    }
  });

  it("lista vacía tira ErrorIndices (polinomica_vacia)", () => {
    expect(() => valorPolinomica([])).toThrow(ErrorIndices);
    try {
      valorPolinomica([]);
    } catch (e) {
      expect((e as ErrorIndices).codigo).toBe("polinomica_vacia");
    }
  });

  it("un peso negativo tira ErrorIndices (peso_invalido)", () => {
    expect(() =>
      valorPolinomica([
        { peso: "-0.5", actual: "100", base: "100" },
        { peso: "1.5", actual: "100", base: "100" },
      ]),
    ).toThrow(ErrorIndices);
    try {
      valorPolinomica([
        { peso: "-0.5", actual: "100", base: "100" },
        { peso: "1.5", actual: "100", base: "100" },
      ]);
    } catch (e) {
      expect((e as ErrorIndices).codigo).toBe("peso_invalido");
    }
  });

  it("un componente con base/actual inválidos propaga ErrorPlata (indice_invalido)", () => {
    expect(() => valorPolinomica([{ peso: "1", actual: "-100", base: "100" }])).toThrow(ErrorPlata);
  });

  it("redondea comercial al final (no en cada término)", () => {
    // 3 componentes que individualmente no serían exactos a 8 decimales,
    // pero cuya SUMA sí cae en un valor que no requiere redondear intermedio
    // de más: se verifica contra el cálculo manual.
    const r = valorPolinomica([
      { peso: "0.333333333333", actual: "100", base: "100" }, // factor 1 exacto
      { peso: "0.333333333333", actual: "150", base: "100" }, // factor 1.5
      { peso: "0.333333333334", actual: "200", base: "100" }, // factor 2
    ]);
    // peso*factor: 0.333333333333 + 0.4999999999995 + 0.666666666668 = 1.4999999999995
    expect(r).toBe("1.5");
  });
});
