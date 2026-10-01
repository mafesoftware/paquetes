import { describe, expect, it } from "vitest";
import { buscarCombinacion } from "../src/combinaciones.js";

describe("buscarCombinacion", () => {
  it("encuentra un par que suma exacto (mismo signo que el objetivo)", () => {
    const candidatos = [
      { id: "a", importe: -30_000_000n },
      { id: "b", importe: -20_000_000n },
      { id: "c", importe: -10_000_000n },
    ];
    const combo = buscarCombinacion(-50_000_000n, candidatos, 4);
    expect(combo).not.toBeNull();
    expect(new Set(combo)).toEqual(new Set(["a", "b"]));
  });

  it("no arma combinación de un solo elemento (eso lo resuelve importe_fecha)", () => {
    const candidatos = [{ id: "a", importe: -50_000_000n }];
    expect(buscarCombinacion(-50_000_000n, candidatos, 4)).toBeNull();
  });

  it("respeta maxCombinacion: no arma con 5 elementos si el máximo es 4", () => {
    const candidatos = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, importe: -10_000_000n }));
    expect(buscarCombinacion(-50_000_000n, candidatos, 4)).toBeNull();
    expect(buscarCombinacion(-50_000_000n, candidatos, 5)).not.toBeNull();
  });

  it("sin combinación posible → null", () => {
    const candidatos = [
      { id: "a", importe: -1_000n },
      { id: "b", importe: -2_000n },
    ];
    expect(buscarCombinacion(-999_999n, candidatos, 4)).toBeNull();
  });
});
