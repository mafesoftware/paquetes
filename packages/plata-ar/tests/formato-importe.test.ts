import { describe, expect, it } from "vitest";
import { formatearPlata } from "../src/index.ts";

describe("formatearPlata (Importe | bigint, API 0.2)", () => {
  it('{centavos:-5000n, moneda:"USD"} -> "-US$ 50,00"', () => {
    // El espacio que usa Intl es U+00A0 (nbsp); \s lo matchea.
    expect(formatearPlata({ centavos: -5000n, moneda: "USD" })).toMatch(/^-US\$\s50,00$/);
  });

  it("un bigint a secas usa ARS por defecto", () => {
    expect(formatearPlata(4_400_000n)).toMatch(/^\$\s44\.000,00$/);
  });

  it("un Importe positivo en ARS", () => {
    expect(formatearPlata({ centavos: 123_456n, moneda: "ARS" })).toMatch(/^\$\s1\.234,56$/);
  });

  it("a diferencia de la 0.1, siempre muestra los dos decimales por defecto", () => {
    expect(formatearPlata({ centavos: 100_000n, moneda: "USD" })).toMatch(/,00$/);
  });

  it("decimalesSiempre:false oculta los decimales en un monto redondo", () => {
    expect(formatearPlata({ centavos: 100_000n, moneda: "ARS" }, { decimalesSiempre: false })).not.toMatch(/,00$/);
  });

  it("opciones.moneda tiene efecto sobre un bigint a secas", () => {
    expect(formatearPlata(5000n, { moneda: "EUR" })).toContain("50,00");
  });

  describe("I3: opciones.moneda NO tiene efecto sobre un Importe (la moneda la trae el propio Importe)", () => {
    it('formatearPlata({centavos:5000n, moneda:"USD"}, {moneda:"ARS"}) no imprime pesos', () => {
      const resultado = formatearPlata({ centavos: 5000n, moneda: "USD" }, { moneda: "ARS" });
      expect(resultado).toContain("US$");
      expect(resultado).not.toMatch(/^\$/); // no arranca con el símbolo de ARS
    });

    it("un Importe negativo tampoco se deja pisar la moneda", () => {
      const resultado = formatearPlata({ centavos: -5000n, moneda: "USD" }, { moneda: "ARS" });
      expect(resultado).toMatch(/^-US\$\s50,00$/);
    });
  });

  describe("I2: formatea exacto más allá de Number.MAX_SAFE_INTEGER centavos", () => {
    it("9_007_199_254_740_993n (MAX_SAFE_INTEGER + 2) termina en ,93 y no pierde dígitos", () => {
      // Number(9_007_199_254_740_993n) ya no es exacto (colapsa con el vecino
      // par), así que Number(centavos)/100 redondearía mal los centavos.
      const resultado = formatearPlata(9_007_199_254_740_993n);
      expect(resultado).toMatch(/,93$/);
      expect(resultado).toMatch(/^\$\s90\.071\.992\.547\.409,93$/);
    });

    it("lo mismo en negativo y en USD", () => {
      const resultado = formatearPlata({ centavos: -9_007_199_254_740_993n, moneda: "USD" });
      expect(resultado).toMatch(/^-US\$\s90\.071\.992\.547\.409,93$/);
    });

    it("un monto aún más grande (10^30 centavos) sigue exacto", () => {
      const centavos = 10n ** 30n + 7n; // ...07 centavos
      const resultado = formatearPlata(centavos);
      expect(resultado).toMatch(/,07$/);
    });
  });

  it("sigue funcionando la firma 0.1 (Centavos number)", () => {
    expect(formatearPlata(4_400_000)).not.toMatch(/,00/);
    expect(formatearPlata(25914)).toMatch(/,14/);
  });
});
