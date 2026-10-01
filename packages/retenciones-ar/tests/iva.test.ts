import { describe, expect, it } from "vitest";
import { retencionIva } from "../src/iva.js";
import type { Exclusion } from "../src/tipos.js";

/** Fixture del brief Tarea 4.18: 50% del IVA, retención mínima $400. */
const ALICUOTA = "50";
const RETENCION_MINIMA = 400_00n;
const FECHA = "2026-09-15";

describe("retencionIva (brief)", () => {
  it("factura A neto 1.000.000, IVA 210.000, pago total → 105.000", () => {
    const r = retencionIva({
      ivaDelPago: 210_000_00n,
      alicuotaSobreIva: ALICUOTA,
      retencionMinima: RETENCION_MINIMA,
      exclusion: null,
      fechaPago: FECHA,
      ultimoPagoDelDocumento: true,
      ivaDocumento: 210_000_00n,
      retenidoDocumento: 0n,
    });
    expect(r.importe).toBe(105_000_00n);
  });

  it("dos pagos del 50% → 52.500 + 52.500 (el último ajusta para que Σ dé exacto)", () => {
    const primero = retencionIva({
      ivaDelPago: 105_000_00n,
      alicuotaSobreIva: ALICUOTA,
      retencionMinima: RETENCION_MINIMA,
      exclusion: null,
      fechaPago: FECHA,
      ultimoPagoDelDocumento: false,
      ivaDocumento: 210_000_00n,
      retenidoDocumento: 0n,
    });
    expect(primero.importe).toBe(52_500_00n);

    const segundo = retencionIva({
      ivaDelPago: 105_000_00n,
      alicuotaSobreIva: ALICUOTA,
      retencionMinima: RETENCION_MINIMA,
      exclusion: null,
      fechaPago: FECHA,
      ultimoPagoDelDocumento: true,
      ivaDocumento: 210_000_00n,
      retenidoDocumento: primero.importe,
    });
    expect(segundo.importe).toBe(52_500_00n);
    expect(primero.importe + segundo.importe).toBe(105_000_00n);
  });

  it("exclusión 60% → 42.000", () => {
    const exclusion: Exclusion = { regimen: "iva", porcentaje: "60", desde: "2026-01-01", hasta: "2026-12-31", certificado: "AFIP-CERT-2" };
    const r = retencionIva({
      ivaDelPago: 210_000_00n,
      alicuotaSobreIva: ALICUOTA,
      retencionMinima: RETENCION_MINIMA,
      exclusion,
      fechaPago: FECHA,
      ultimoPagoDelDocumento: true,
      ivaDocumento: 210_000_00n,
      retenidoDocumento: 0n,
    });
    expect(r.importe).toBe(42_000_00n);
    expect(r.exclusionAplicada).toEqual(exclusion);
  });

  it("retención calculada por debajo del mínimo ($400) → 0", () => {
    const r = retencionIva({
      ivaDelPago: 700_00n, // 50% = 350,00 < 400,00
      alicuotaSobreIva: ALICUOTA,
      retencionMinima: RETENCION_MINIMA,
      exclusion: null,
      fechaPago: FECHA,
      ultimoPagoDelDocumento: true,
      ivaDocumento: 700_00n,
      retenidoDocumento: 0n,
    });
    expect(r.importe).toBe(0n);
  });

  it("proveedor monotributo (sin IVA discriminado) → no aplica", () => {
    const r = retencionIva({
      ivaDelPago: 0n,
      alicuotaSobreIva: ALICUOTA,
      retencionMinima: RETENCION_MINIMA,
      exclusion: null,
      fechaPago: FECHA,
      ultimoPagoDelDocumento: true,
      ivaDocumento: 0n,
      retenidoDocumento: 0n,
    });
    expect(r.importe).toBe(0n);
    expect(r.explicacion).toBe("monotributista: no corresponde");
  });

  it("dos pagos que suman el iva del documento exacto: Σ retenciones = alícuota sobre el iva total (regresión del caso de dos pagos)", () => {
    // Caso concreto (no fast-check: con montos chicos el redondeo half-up independiente
    // de cada pago NO último puede acumular más que la alícuota sobre el total, y el
    // último quedaría en 0 en vez de ajustar — la garantía del contrato es sobre montos
    // reales, no sobre cualquier partición arbitraria de centavos).
    let retenidoDocumento = 0n;
    for (const [ivaDelPago, ultimoPagoDelDocumento] of [[70_000_00n, false], [140_000_00n, true]] as const) {
      const r = retencionIva({
        ivaDelPago,
        alicuotaSobreIva: ALICUOTA,
        retencionMinima: 0n,
        exclusion: null,
        fechaPago: FECHA,
        ultimoPagoDelDocumento,
        ivaDocumento: 210_000_00n,
        retenidoDocumento,
      });
      retenidoDocumento += r.importe;
    }
    expect(retenidoDocumento).toBe(105_000_00n);
  });
});
