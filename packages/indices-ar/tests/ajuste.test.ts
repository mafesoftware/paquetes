import { describe, expect, it } from "vitest";
import { ErrorPlata } from "@mafesoftware/plata-ar";
import { calcularAjuste } from "../src/ajuste.js";

describe("calcularAjuste", () => {
  it("caso del brief: 100.000 x 3662,2/3448,3", () => {
    const r = calcularAjuste(10_000_000n, "3448.3", "3662.2");
    expect(r.factor).toBe("1.06203057");
    expect(r.montoAjustado).toBe(10_620_306n);
    expect(r.ajuste).toBe(620_306n);
  });

  it("factor 1 (mismo valor): ajuste 0", () => {
    const r = calcularAjuste(5_000_000n, "100", "100");
    expect(r.factor).toBe("1");
    expect(r.montoAjustado).toBe(5_000_000n);
    expect(r.ajuste).toBe(0n);
  });

  it("valorRef < valorBase: factor y ajuste negativos (deflación)", () => {
    const r = calcularAjuste(10_000_000n, "100", "90");
    expect(r.factor).toBe("0.9");
    expect(r.montoAjustado).toBe(9_000_000n);
    expect(r.ajuste).toBe(-1_000_000n);
  });

  it("montoBase 0: ajustado y ajuste quedan en 0 sin importar el factor", () => {
    const r = calcularAjuste(0n, "100", "200");
    expect(r.montoAjustado).toBe(0n);
    expect(r.ajuste).toBe(0n);
  });

  it("valorBase/valorRef inválidos: propaga ErrorPlata (indice_invalido), no lo reenvuelve", () => {
    expect(() => calcularAjuste(1_000_000n, "-100", "200")).toThrow(ErrorPlata);
    expect(() => calcularAjuste(1_000_000n, "abc", "200")).toThrow(ErrorPlata);
    expect(() => calcularAjuste(1_000_000n, "0", "200")).toThrow(ErrorPlata);
  });
});
