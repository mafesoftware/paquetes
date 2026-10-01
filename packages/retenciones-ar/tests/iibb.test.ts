import { describe, expect, it } from "vitest";
import { retencionIibb } from "../src/iibb.js";

const FECHA = "2026-09-15";

describe("retencionIibb (brief)", () => {
  it("ARBA, padrón 1,75%, neto 1.000.000 → 17.500", () => {
    const r = retencionIibb({
      netoPago: 1_000_000_00n,
      jurisdiccion: "ARBA",
      alicuotaPadron: "1.75",
      alicuotaNoPadron: "0",
      convenioMultilateral: false,
      baseCmPct: "100",
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(17_500_00n);
  });

  it("Convenio Multilateral, base 50% del neto → 8.750 (1,75% sobre 500.000)", () => {
    const r = retencionIibb({
      netoPago: 1_000_000_00n,
      jurisdiccion: "ARBA",
      alicuotaPadron: "1.75",
      alicuotaNoPadron: "0",
      convenioMultilateral: true,
      baseCmPct: "50",
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.base).toBe(500_000_00n);
    expect(r.importe).toBe(8_750_00n);
  });

  it("CUIT fuera del padrón ARBA → alícuota por defecto (fixture 0) → 0, con explicación", () => {
    const r = retencionIibb({
      netoPago: 1_000_000_00n,
      jurisdiccion: "ARBA",
      alicuotaPadron: null,
      alicuotaNoPadron: "0",
      convenioMultilateral: false,
      baseCmPct: "100",
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(0n);
    expect(r.explicacion).toBe("no figura en el padrón ARBA de 2026-09");
  });

  it("AGIP, retención 1,50%, neto 1.000.000 → 15.000", () => {
    const r = retencionIibb({
      netoPago: 1_000_000_00n,
      jurisdiccion: "AGIP",
      alicuotaPadron: "1.5",
      alicuotaNoPadron: "0",
      convenioMultilateral: false,
      baseCmPct: "100",
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(15_000_00n);
  });
});
