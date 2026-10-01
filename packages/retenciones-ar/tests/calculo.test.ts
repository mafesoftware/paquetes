import { describe, expect, it } from "vitest";
import { aplicarExclusion, aplicarPorcentaje, formatearPesos, max0, netoDelPago } from "../src/calculo.js";
import type { Exclusion } from "../src/tipos.js";

describe("max0", () => {
  it("negativo → 0n; positivo se mantiene", () => {
    expect(max0(-1n)).toBe(0n);
    expect(max0(0n)).toBe(0n);
    expect(max0(5n)).toBe(5n);
  });
});

describe("aplicarPorcentaje", () => {
  it("2% de 82.830,00 (centavos) = 1.656,60", () => {
    expect(aplicarPorcentaje(82_830_00n, "2")).toBe(1_656_60n);
  });

  it("acepta porcentaje con decimales (1,75%)", () => {
    expect(aplicarPorcentaje(1_000_000_00n, "1.75")).toBe(17_500_00n);
  });

  it("redondea comercial solo al final (medio hacia arriba)", () => {
    // 19% de 830,00 = 157,70 exacto (sin drama de redondeo, pero confirma la fracción exacta)
    expect(aplicarPorcentaje(830_00n, "19")).toBe(157_70n);
  });
});

describe("aplicarExclusion", () => {
  const EXCLUSION_60: Exclusion = { regimen: "iva", porcentaje: "60", desde: "2026-01-01", hasta: "2026-12-31", certificado: "C-1" };
  const EXCLUSION_100: Exclusion = { ...EXCLUSION_60, porcentaje: "100" };

  it("null → no cambia el importe", () => {
    expect(aplicarExclusion(105_000_00n, null)).toBe(105_000_00n);
  });

  it("60% → reduce al 40%", () => {
    expect(aplicarExclusion(105_000_00n, EXCLUSION_60)).toBe(42_000_00n);
  });

  it("100% → 0", () => {
    expect(aplicarExclusion(105_000_00n, EXCLUSION_100)).toBe(0n);
  });
});

describe("formatearPesos", () => {
  it("formatea centavos con punto de miles y coma decimal", () => {
    expect(formatearPesos(8_283_000n)).toBe("82.830,00");
    expect(formatearPesos(15_000_000n)).toBe("150.000,00");
    expect(formatearPesos(0n)).toBe("0,00");
  });
});

describe("netoDelPago", () => {
  const DOCUMENTO = { neto: 100_000_00n, total: 121_000_00n }; // ej. neto + IVA 21%

  it("pago total (pagado === total) → el neto completo, sin pasar por redondeo", () => {
    expect(netoDelPago(DOCUMENTO, DOCUMENTO.total)).toBe(DOCUMENTO.neto);
  });

  it("pagado > total (de más) → igual el neto completo", () => {
    expect(netoDelPago(DOCUMENTO, DOCUMENTO.total + 1_000_00n)).toBe(DOCUMENTO.neto);
  });

  it("pago parcial → proporción exacta", () => {
    // 50% del total → 50% del neto
    expect(netoDelPago(DOCUMENTO, DOCUMENTO.total / 2n)).toBe(DOCUMENTO.neto / 2n);
  });

  it("dos pagos consecutivos (acumulado): el segundo (último) absorbe el resto de redondeo, Σ = neto exacto", () => {
    const primerPagoAcumulado = 40_333_00n; // no divide exacto al neto
    const incrementoUno = netoDelPago(DOCUMENTO, primerPagoAcumulado);
    const incrementoDos = netoDelPago(DOCUMENTO, DOCUMENTO.total) - incrementoUno; // acumulado llega al total
    expect(incrementoUno + incrementoDos).toBe(DOCUMENTO.neto);
  });

  it("documento con total 0 → 0 (no divide por cero)", () => {
    expect(netoDelPago({ neto: 0n, total: 0n }, 0n)).toBe(0n);
  });
});
