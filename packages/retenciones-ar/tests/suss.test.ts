import { describe, expect, it } from "vitest";
import { retencionSuss } from "../src/suss.js";

/** Fixture del brief Tarea 4.18: con MO 2,5%, sin MO 1,2%, mínimo $400. */
const ALICUOTA_CON_MO = "2.5";
const ALICUOTA_SIN_MO = "1.2";
const RETENCION_MINIMA = 400_00n;
const FECHA = "2026-09-15";

describe("retencionSuss (brief)", () => {
  it("neto 2.000.000 con mano de obra → 50.000", () => {
    const r = retencionSuss({
      netoPago: 2_000_000_00n,
      conManoDeObra: true,
      alicuotaConMO: ALICUOTA_CON_MO,
      alicuotaSinMO: ALICUOTA_SIN_MO,
      retencionMinima: RETENCION_MINIMA,
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(50_000_00n);
  });

  it("neto 1.000.000 con mano de obra → 25.000", () => {
    const r = retencionSuss({
      netoPago: 1_000_000_00n,
      conManoDeObra: true,
      alicuotaConMO: ALICUOTA_CON_MO,
      alicuotaSinMO: ALICUOTA_SIN_MO,
      retencionMinima: RETENCION_MINIMA,
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(25_000_00n);
  });

  it("neto 10.000 sin mano de obra → 120 < mínimo 400 → 0", () => {
    const r = retencionSuss({
      netoPago: 10_000_00n,
      conManoDeObra: false,
      alicuotaConMO: ALICUOTA_CON_MO,
      alicuotaSinMO: ALICUOTA_SIN_MO,
      retencionMinima: RETENCION_MINIMA,
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(0n);
  });
});
