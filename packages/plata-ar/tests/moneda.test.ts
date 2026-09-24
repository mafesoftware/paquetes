import { describe, expect, it } from "vitest";
import { convertir, sumar, type Importe } from "../src/moneda.ts";
import { ErrorPlata } from "../src/errores.ts";

describe("convertir", () => {
  it("aplica el tipo de cambio y cambia la moneda", () => {
    const usd: Importe = { centavos: 100_000n, moneda: "USD" };
    const ars = convertir(usd, "ARS", "1050.50");
    expect(ars.moneda).toBe("ARS");
    expect(ars.centavos).toBe(105_050_000n);
  });

  it("ida y vuelta con un TC exactamente invertible no pierde nada", () => {
    const usd: Importe = { centavos: 250_000n, moneda: "USD" };
    const ars = convertir(usd, "ARS", "2");
    const vuelta = convertir(ars, "USD", "0.5");
    expect(vuelta.centavos).toBe(usd.centavos);
  });

  it("ida y vuelta con un TC que no invierte exacto difiere del original en como mucho ±1 centavo", () => {
    // 1/3 no tiene representación exacta en 8 decimales: la vuelta puede
    // perder o ganar, como mucho, un centavo por el redondeo de cada paso.
    const casos: Array<[Importe, string, string]> = [
      [{ centavos: 1_000_000n, moneda: "USD" }, "3.33333333", "0.30000000"],
      [{ centavos: 999_999n, moneda: "ARS" }, "0.85123456", "1.17476433"],
      [{ centavos: 50_000_000n, moneda: "USD" }, "1.06203057", "0.94159248"],
    ];
    for (const [original, tc, tcInverso] of casos) {
      const ida = convertir(original, "ARS", tc);
      const vuelta = convertir(ida, original.moneda, tcInverso);
      const diferencia =
        vuelta.centavos > original.centavos ? vuelta.centavos - original.centavos : original.centavos - vuelta.centavos;
      expect(diferencia <= 1n, `original ${original.centavos}, vuelta ${vuelta.centavos}`).toBe(true);
    }
  });
});

describe("sumar", () => {
  it("suma importes de la misma moneda", () => {
    const total = sumar({ centavos: 100n, moneda: "ARS" }, { centavos: 250n, moneda: "ARS" });
    expect(total).toEqual({ centavos: 350n, moneda: "ARS" });
  });

  it("ARS + USD tira ErrorPlata (moneda_mezclada)", () => {
    expect(() => sumar({ centavos: 100n, moneda: "ARS" }, { centavos: 100n, moneda: "USD" })).toThrow(ErrorPlata);
    try {
      sumar({ centavos: 100n, moneda: "ARS" }, { centavos: 100n, moneda: "USD" });
    } catch (e) {
      expect((e as ErrorPlata).codigo).toBe("moneda_mezclada");
    }
  });

  it("sin importes tira ErrorPlata (sumar_sin_importes)", () => {
    expect(() => sumar()).toThrow(ErrorPlata);
    try {
      sumar();
    } catch (e) {
      expect((e as ErrorPlata).codigo).toBe("sumar_sin_importes");
    }
  });

  it("un solo importe se devuelve igual", () => {
    expect(sumar({ centavos: 500n, moneda: "EUR" })).toEqual({ centavos: 500n, moneda: "EUR" });
  });
});
