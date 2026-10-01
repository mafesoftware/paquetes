import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { retencionGanancias } from "../src/ganancias.js";
import type { Exclusion, TablaGanancias } from "../src/tipos.js";

/**
 * Fixture declarada en el propio test (brief Tarea 4.18) — NO depende del
 * seed `regimenes-2026.ts`, para que la aritmética no dependa de datos que
 * puedan cambiar.
 */
const LOCACION_094: TablaGanancias = {
  concepto: "094",
  codigoSicore: "094",
  minimoNoSujeto: 67_170_00n,
  alicuotaInscripto: "2",
  alicuotaNoInscripto: "28",
  retencionMinima: 240_00n,
};

const BIENES_078: TablaGanancias = {
  concepto: "078",
  codigoSicore: "078",
  minimoNoSujeto: 224_000_00n,
  alicuotaInscripto: "2",
  alicuotaNoInscripto: "10",
  retencionMinima: 240_00n,
};

const HONORARIOS_116: TablaGanancias = {
  concepto: "116",
  codigoSicore: "116",
  minimoNoSujeto: 67_170_00n,
  alicuotaInscripto: "escala",
  alicuotaNoInscripto: "28",
  escala: [
    { desde: 0n, hasta: 8_000_00n, fijo: 0n, porcentaje: "5" },
    { desde: 8_000_00n, hasta: 16_000_00n, fijo: 400_00n, porcentaje: "9" },
    { desde: 16_000_00n, hasta: 24_000_00n, fijo: 1_120_00n, porcentaje: "12" },
    { desde: 24_000_00n, hasta: 32_000_00n, fijo: 2_080_00n, porcentaje: "15" },
    { desde: 32_000_00n, hasta: 48_000_00n, fijo: 3_280_00n, porcentaje: "19" },
    { desde: 48_000_00n, hasta: 64_000_00n, fijo: 6_320_00n, porcentaje: "23" },
    { desde: 64_000_00n, hasta: 96_000_00n, fijo: 10_000_00n, porcentaje: "27" },
    { desde: 96_000_00n, hasta: null, fijo: 18_640_00n, porcentaje: "31" },
  ],
  retencionMinima: 240_00n,
};

const FECHA = "2026-09-15";

describe("retencionGanancias — locación de obra/servicios 094, inscripto (brief)", () => {
  it("pago 1: neto 50.000, acumulado 50.000 < mínimo 67.170 → 0", () => {
    const r = retencionGanancias({
      netoPago: 50_000_00n,
      acumuladoNetoMes: 50_000_00n,
      retenidoMes: 0n,
      inscripto: true,
      tabla: LOCACION_094,
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(0n);
  });

  it("pago 2: neto 100.000, acumulado 150.000 → base 82.830 → 1.656,60", () => {
    const r = retencionGanancias({
      netoPago: 100_000_00n,
      acumuladoNetoMes: 150_000_00n,
      retenidoMes: 0n,
      inscripto: true,
      tabla: LOCACION_094,
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.base).toBe(82_830_00n);
    expect(r.importe).toBe(1_656_60n);
    expect(r.explicacion).toBe("Base 82.830,00 = pagos del mes 150.000,00 − mínimo 67.170,00; 2%");
  });

  it("pago 3: neto 30.000, acumulado 180.000 → base 112.830 → 600,00 (2.256,60 − 1.656,60 ya retenido)", () => {
    const r = retencionGanancias({
      netoPago: 30_000_00n,
      acumuladoNetoMes: 180_000_00n,
      retenidoMes: 1_656_60n,
      inscripto: true,
      tabla: LOCACION_094,
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(600_00n);
  });

  it("pago 4: neto 5.000, acumulado 185.000 → incremento 100,00 < mínimo 240 → 0", () => {
    const r = retencionGanancias({
      netoPago: 5_000_00n,
      acumuladoNetoMes: 185_000_00n,
      retenidoMes: 2_256_60n, // 1.656,60 + 600,00 ya retenidos
      inscripto: true,
      tabla: LOCACION_094,
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(0n);
  });

  it("pago 5: neto 10.000, acumulado 195.000 → 300,00 (el retenido no subió con el pago 4, que dio 0)", () => {
    const r = retencionGanancias({
      netoPago: 10_000_00n,
      acumuladoNetoMes: 195_000_00n,
      retenidoMes: 2_256_60n, // sin cambios: el pago 4 no sumó nada al acumulado retenido
      inscripto: true,
      tabla: LOCACION_094,
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(300_00n);
  });

  it("primer pago de octubre, neto 50.000 → 0 (el mes reinicia: acumulado y retenido vuelven a cero)", () => {
    const r = retencionGanancias({
      netoPago: 50_000_00n,
      acumuladoNetoMes: 50_000_00n,
      retenidoMes: 0n,
      inscripto: true,
      tabla: LOCACION_094,
      exclusion: null,
      fechaPago: "2026-10-05",
    });
    expect(r.importe).toBe(0n);
  });

  it("no inscripto, neto 100.000 → 28.000 exacto, sin mínimo no sujeto", () => {
    const r = retencionGanancias({
      netoPago: 100_000_00n,
      acumuladoNetoMes: 100_000_00n,
      retenidoMes: 0n,
      inscripto: false,
      tabla: LOCACION_094,
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(28_000_00n);
    expect(r.explicacion).toContain("sin mínimo");
  });

  it("exclusión 100% vigente → 0, con exclusionAplicada", () => {
    const exclusion: Exclusion = { regimen: "ganancias", porcentaje: "100", desde: "2026-01-01", hasta: "2026-12-31", certificado: "AFIP-CERT-9" };
    const r = retencionGanancias({
      netoPago: 100_000_00n,
      acumuladoNetoMes: 100_000_00n,
      retenidoMes: 0n,
      inscripto: true,
      tabla: LOCACION_094,
      exclusion,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(0n);
    expect(r.exclusionAplicada).toEqual(exclusion);
  });

  it("exclusión vencida el día anterior al pago → ya resuelta a null por exclusionVigente, retención normal", () => {
    // Quien llama resuelve la vigencia con `exclusionVigente` (exclusiones.ts) ANTES de invocar
    // esta función — acá solo se confirma que `exclusion: null` no cambia el resultado del pago 2.
    const r = retencionGanancias({
      netoPago: 100_000_00n,
      acumuladoNetoMes: 150_000_00n,
      retenidoMes: 0n,
      inscripto: true,
      tabla: LOCACION_094,
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(1_656_60n);
  });
});

describe("retencionGanancias — honorarios 116, escala progresiva (brief)", () => {
  it("primer honorario del mes, neto 100.000 → base 32.830 → 3.280 + 19% × 830 = 3.437,70", () => {
    const r = retencionGanancias({
      netoPago: 100_000_00n,
      acumuladoNetoMes: 100_000_00n,
      retenidoMes: 0n,
      inscripto: true,
      tabla: HONORARIOS_116,
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.base).toBe(32_830_00n);
    expect(r.importe).toBe(3_437_70n);
  });

  it("segundo honorario del mes, neto 20.000 → base 52.830 (cambio de escala) → 3.993,20", () => {
    const r = retencionGanancias({
      netoPago: 20_000_00n,
      acumuladoNetoMes: 120_000_00n,
      retenidoMes: 3_437_70n,
      inscripto: true,
      tabla: HONORARIOS_116,
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.base).toBe(52_830_00n);
    expect(r.importe).toBe(3_993_20n);
  });
});

describe("retencionGanancias — bienes 078 (fixture del brief, sin caso numérico propio)", () => {
  it("inscripto, por debajo del mínimo (224.000) → 0", () => {
    const r = retencionGanancias({
      netoPago: 100_000_00n,
      acumuladoNetoMes: 100_000_00n,
      retenidoMes: 0n,
      inscripto: true,
      tabla: BIENES_078,
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(0n);
  });

  it("no inscripto, neto 100.000 → 10% = 10.000, sin mínimo", () => {
    const r = retencionGanancias({
      netoPago: 100_000_00n,
      acumuladoNetoMes: 100_000_00n,
      retenidoMes: 0n,
      inscripto: false,
      tabla: BIENES_078,
      exclusion: null,
      fechaPago: FECHA,
    });
    expect(r.importe).toBe(10_000_00n);
  });
});

describe("retencionGanancias — propiedades (fast-check)", () => {
  it("nunca negativa ni mayor que la base (inscripto, alícuota fija)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10_000_000_00n }),
        fc.bigInt({ min: 0n, max: 10_000_000_00n }),
        (acumulado, retenido) => {
          const r = retencionGanancias({
            netoPago: acumulado,
            acumuladoNetoMes: acumulado,
            retenidoMes: retenido,
            inscripto: true,
            tabla: { ...LOCACION_094, retencionMinima: 0n },
            exclusion: null,
            fechaPago: FECHA,
          });
          expect(r.importe).toBeGreaterThanOrEqual(0n);
          expect(r.importe).toBeLessThanOrEqual(r.base);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("Σ retenciones del mes = retención sobre el acumulado del mes, sin importar cómo se partan los pagos (sin mínimo de retención)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 1n, max: 500_000_00n }), { minLength: 1, maxLength: 15 }),
        (pagos) => {
          const tabla: TablaGanancias = { ...LOCACION_094, retencionMinima: 0n }; // sin mínimo: aísla la propiedad de acumulación
          let acumuladoNetoMes = 0n;
          let retenidoMes = 0n;
          for (const netoPago of pagos) {
            acumuladoNetoMes += netoPago;
            const r = retencionGanancias({ netoPago, acumuladoNetoMes, retenidoMes, inscripto: true, tabla, exclusion: null, fechaPago: FECHA });
            retenidoMes += r.importe;
          }
          const totalDeUnaSolaVez = retencionGanancias({
            netoPago: acumuladoNetoMes,
            acumuladoNetoMes,
            retenidoMes: 0n,
            inscripto: true,
            tabla,
            exclusion: null,
            fechaPago: FECHA,
          });
          expect(retenidoMes).toBe(totalDeUnaSolaVez.importe);
        }
      ),
      { numRuns: 300 }
    );
  });
});
