import { describe, expect, it } from "vitest";
import { diferenciaArqueo, requiereAjusteArqueo } from "../src/arqueo.js";

describe("diferenciaArqueo / requiereAjusteArqueo", () => {
  it("contado > sistema → diferencia positiva (sobra) y requiere ajuste", () => {
    expect(diferenciaArqueo(10_000n, 10_500n)).toBe(500n);
    expect(requiereAjusteArqueo(500n)).toBe(true);
  });

  it("contado < sistema → diferencia negativa (falta) y requiere ajuste", () => {
    expect(diferenciaArqueo(10_000n, 9_800n)).toBe(-200n);
    expect(requiereAjusteArqueo(-200n)).toBe(true);
  });

  it("sin diferencia → no requiere ajuste", () => {
    expect(diferenciaArqueo(10_000n, 10_000n)).toBe(0n);
    expect(requiereAjusteArqueo(0n)).toBe(false);
  });
});
