import { describe, expect, it } from "vitest";
import fc from "fast-check";
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

  it("ida y vuelta con un TC que NO invierte exacto NO garantiza ±1 centavo (dos cotizaciones reales, cargadas por separado)", () => {
    // 0,85123456 y 1,17476433 (la recíproca real de 0,85123456 redondeada a
    // 8 decimales) no multiplican EXACTO a 1 -- por diseño, como pasaría con
    // dos cotizaciones cargadas por separado. El contrato de convertir ya NO
    // promete ±1 acá; con un monto grande la diferencia real es de miles de
    // centavos, no de uno.
    const original: Importe = { centavos: 999_999_999_999n, moneda: "USD" };
    const ida = convertir(original, "ARS", "0.85123456");
    const vuelta = convertir(ida, "USD", "1.17476433");
    const diferencia = vuelta.centavos > original.centavos ? vuelta.centavos - original.centavos : original.centavos - vuelta.centavos;
    expect(diferencia).toBe(2449n);
    expect(diferencia).toBeGreaterThan(1n);
  });

  describe("propiedad (I4): con recíprocos EXACTOS y arrancando en la moneda fuerte, el round trip cae dentro de ±1 centavo", () => {
    // Pares tc/tcInv tales que tc × tcInv === 1 exacto, con tc > 1 (moneda
    // fuerte primero) y tcInv <= 1 (la vuelta).
    const paresReciprocosExactos: Array<[string, string]> = [
      ["2", "0.5"],
      ["4", "0.25"],
      ["1.25", "0.8"],
      ["5", "0.2"],
      ["8", "0.125"],
      ["1.6", "0.625"],
    ];

    it("para cada par, con 500 montos aleatorios", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...paresReciprocosExactos),
          fc.bigInt({ min: 0n, max: 1_000_000_000_000n }),
          ([tc, tcInv], centavosOriginal) => {
            const original: Importe = { centavos: centavosOriginal, moneda: "USD" };
            const ida = convertir(original, "ARS", tc);
            const vuelta = convertir(ida, "USD", tcInv);

            const diferencia =
              vuelta.centavos > original.centavos
                ? vuelta.centavos - original.centavos
                : original.centavos - vuelta.centavos;
            expect(diferencia <= 1n).toBe(true);
          },
        ),
        { numRuns: 3_000 },
      );
    });
  });

  it("tc <= 0 tira ErrorPlata (tc_no_positivo)", () => {
    const usd: Importe = { centavos: 100n, moneda: "USD" };
    for (const tc of ["0", "-1", "-0.5"]) {
      expect(() => convertir(usd, "ARS", tc), `tc "${tc}"`).toThrow(ErrorPlata);
    }
    try {
      convertir(usd, "ARS", "0");
    } catch (e) {
      expect((e as ErrorPlata).codigo).toBe("tc_no_positivo");
    }
  });

  it('convertir a la misma moneda con tc "1" no cambia nada', () => {
    const ars: Importe = { centavos: 12_345n, moneda: "ARS" };
    expect(convertir(ars, "ARS", "1")).toEqual(ars);
    expect(convertir(ars, "ARS", "1.00000000")).toEqual(ars);
  });

  it("convertir a la misma moneda con tc != 1 tira ErrorPlata (tc_identidad)", () => {
    const ars: Importe = { centavos: 12_345n, moneda: "ARS" };
    expect(() => convertir(ars, "ARS", "2")).toThrow(ErrorPlata);
    try {
      convertir(ars, "ARS", "1.5");
    } catch (e) {
      expect((e as ErrorPlata).codigo).toBe("tc_identidad");
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
