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

  it("sigue funcionando la firma 0.1 (Centavos number)", () => {
    expect(formatearPlata(4_400_000)).not.toMatch(/,00/);
    expect(formatearPlata(25914)).toMatch(/,14/);
  });
});
