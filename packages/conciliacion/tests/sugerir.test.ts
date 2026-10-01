import { describe, expect, it } from "vitest";
import { sugerirMatches, type LineaExtracto, type MovConciliable } from "../src/sugerir.js";

/**
 * Cuenta Banco Galicia ARS, sep-2026 (dataset de ejemplo, importes pasados
 * a centavos bigint).
 */
function movimientosDelBrief(): MovConciliable[] {
  return [
    { id: "M1", fecha: "2026-09-03", importe: 110_500_000n, referencia: null, cuitContraparte: null },
    { id: "M2", fecha: "2026-09-05", importe: -104_384_340n, referencia: null, cuitContraparte: null },
    { id: "M3", fecha: "2026-09-10", importe: -30_000_000n, referencia: null, cuitContraparte: null },
    { id: "M4", fecha: "2026-09-10", importe: -20_000_000n, referencia: null, cuitContraparte: null },
    { id: "M5", fecha: "2026-09-15", importe: 25_000_000n, referencia: null, cuitContraparte: null },
    { id: "M6", fecha: "2026-09-25", importe: 9_999_900n, referencia: null, cuitContraparte: "30712345671" },
    { id: "M7", fecha: "2026-09-25", importe: 9_999_900n, referencia: null, cuitContraparte: "30798765432" },
    { id: "M8", fecha: "2026-09-29", importe: -7_500_000n, referencia: null, cuitContraparte: null },
  ];
}

function lineasDelBrief(): LineaExtracto[] {
  return [
    { id: "L1", fecha: "2026-09-03", descripcion: "TRANSFERENCIA RECIBIDA", importe: 110_500_000n, saldo: null, referencia: null },
    { id: "L2", fecha: "2026-09-05", descripcion: "TRANSFERENCIA ENVIADA", importe: -104_384_340n, saldo: null, referencia: null },
    { id: "L3", fecha: "2026-09-11", descripcion: "DEBITO VARIOS", importe: -50_000_000n, saldo: null, referencia: null },
    { id: "L4", fecha: "2026-09-18", descripcion: "TRANSFERENCIA RECIBIDA", importe: 25_000_000n, saldo: null, referencia: null },
    { id: "L5", fecha: "2026-09-25", descripcion: "TRANSF 30712345671", importe: 9_999_900n, saldo: null, referencia: null },
    { id: "L6", fecha: "2026-09-30", descripcion: "IMP.LEY 25413 DEB", importe: -626_306n, saldo: null, referencia: null },
    { id: "L7", fecha: "2026-09-30", descripcion: "IMP.LEY 25413 CRED", importe: -663_000n, saldo: null, referencia: null },
    { id: "L8", fecha: "2026-09-30", descripcion: "COMISION MANTENIMIENTO CTA", importe: -1_210_000n, saldo: null, referencia: null },
    { id: "L9", fecha: "2026-09-30", descripcion: "INTERESES ACREDITADOS", importe: 85_025n, saldo: null, referencia: null },
  ];
}

function porLinea(sugerencias: ReturnType<typeof sugerirMatches>, lineaId: string) {
  return sugerencias.find((s) => s.lineaIds.includes(lineaId));
}

describe("sugerirMatches — dataset del brief (Banco Galicia ARS, sep-2026)", () => {
  it("L1↔M1 y L2↔M2 por importe y fecha exacta, confianza máxima", () => {
    const sugerencias = sugerirMatches(lineasDelBrief(), movimientosDelBrief(), { toleranciaDias: 3, maxCombinacion: 4 });

    const s1 = porLinea(sugerencias, "L1");
    expect(s1).toMatchObject({ movimientoIds: ["M1"], regla: "importe_fecha", diferenciaDias: 0, confianza: 1 });

    const s2 = porLinea(sugerencias, "L2");
    expect(s2).toMatchObject({ movimientoIds: ["M2"], regla: "importe_fecha", diferenciaDias: 0, confianza: 1 });
  });

  it("L4↔M5 a 3 días entra con tolerancia 3, pero no con tolerancia 2", () => {
    const conTolerancia3 = sugerirMatches(lineasDelBrief(), movimientosDelBrief(), { toleranciaDias: 3, maxCombinacion: 4 });
    const s4 = porLinea(conTolerancia3, "L4");
    expect(s4).toMatchObject({ movimientoIds: ["M5"], regla: "importe_fecha", diferenciaDias: 3 });

    const conTolerancia2 = sugerirMatches(lineasDelBrief(), movimientosDelBrief(), { toleranciaDias: 2, maxCombinacion: 4 });
    expect(porLinea(conTolerancia2, "L4")).toBeUndefined();
  });

  it("L5↔M6 por CUIT en la descripción, nunca M7 (mismo importe y fecha, otro CUIT)", () => {
    const sugerencias = sugerirMatches(lineasDelBrief(), movimientosDelBrief(), { toleranciaDias: 3, maxCombinacion: 4 });

    const s5 = porLinea(sugerencias, "L5");
    expect(s5).toMatchObject({ movimientoIds: ["M6"], regla: "referencia_cuit" });
    expect(sugerencias.some((s) => s.movimientoIds.includes("M7"))).toBe(false);
  });

  it("L3↔{M3,M4} por combinación", () => {
    const sugerencias = sugerirMatches(lineasDelBrief(), movimientosDelBrief(), { toleranciaDias: 3, maxCombinacion: 4 });

    const s3 = porLinea(sugerencias, "L3");
    expect(s3?.regla).toBe("combinacion");
    expect(new Set(s3?.movimientoIds)).toEqual(new Set(["M3", "M4"]));
  });

  it("ninguna línea ni movimiento se sugiere dos veces", () => {
    const sugerencias = sugerirMatches(lineasDelBrief(), movimientosDelBrief(), { toleranciaDias: 3, maxCombinacion: 4 });

    const lineaIds = sugerencias.flatMap((s) => s.lineaIds);
    const movIds = sugerencias.flatMap((s) => s.movimientoIds);
    expect(new Set(lineaIds).size).toBe(lineaIds.length);
    expect(new Set(movIds).size).toBe(movIds.length);
  });

  it("L6–L9 quedan sin sugerencia (son gastos/impuestos bancarios, solo en el extracto)", () => {
    const sugerencias = sugerirMatches(lineasDelBrief(), movimientosDelBrief(), { toleranciaDias: 3, maxCombinacion: 4 });

    for (const id of ["L6", "L7", "L8", "L9"]) {
      expect(porLinea(sugerencias, id)).toBeUndefined();
    }
  });

  it("M7 y M8 quedan sin match (ningún movimiento sugerido los incluye)", () => {
    const sugerencias = sugerirMatches(lineasDelBrief(), movimientosDelBrief(), { toleranciaDias: 3, maxCombinacion: 4 });

    const movIds = new Set(sugerencias.flatMap((s) => s.movimientoIds));
    expect(movIds.has("M7")).toBe(false);
    expect(movIds.has("M8")).toBe(false);
  });
});

describe("sugerirMatches — combinación acotada por maxCombinacion", () => {
  it("encuentra una combinación de 4 movimientos, pero no de 5, con maxCombinacion: 4", () => {
    // Línea por 500.000; 5 movimientos de 100.000 cada uno suman exacto con
    // los 5, pero solo con 4 ya se pasa (400.000 ≠ 500.000): fuerza a que la
    // ÚNICA combinación exacta posible use los 5, así maxCombinacion: 4 la
    // deja sin match.
    const linea: LineaExtracto = {
      id: "L1",
      fecha: "2026-09-15",
      descripcion: "DEBITO VARIOS",
      importe: -50_000_000n,
      saldo: null,
      referencia: null,
    };
    const movs: MovConciliable[] = Array.from({ length: 5 }, (_, i) => ({
      id: `M${i + 1}`,
      fecha: "2026-09-15",
      importe: -10_000_000n,
      referencia: null,
      cuitContraparte: null,
    }));

    const con4 = sugerirMatches([linea], movs, { toleranciaDias: 3, maxCombinacion: 4 });
    expect(con4.find((s) => s.lineaIds.includes("L1"))).toBeUndefined();

    const con5 = sugerirMatches([linea], movs, { toleranciaDias: 3, maxCombinacion: 5 });
    const s = con5.find((sg) => sg.lineaIds.includes("L1"));
    expect(s?.regla).toBe("combinacion");
    expect(s?.movimientoIds).toHaveLength(5);
  });
});

describe("sugerirMatches — performance", () => {
  it("500 líneas × 500 movimientos < 1s", () => {
    const movs: MovConciliable[] = Array.from({ length: 500 }, (_, i) => ({
      id: `m${i}`,
      fecha: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
      importe: BigInt((i % 2 === 0 ? 1 : -1) * (1000 + i) * 100),
      referencia: null,
      cuitContraparte: null,
    }));
    const lineas: LineaExtracto[] = Array.from({ length: 500 }, (_, i) => ({
      id: `l${i}`,
      fecha: `2026-09-${String(((i + 1) % 28) + 1).padStart(2, "0")}`,
      descripcion: "MOVIMIENTO VARIO",
      importe: BigInt((i % 2 === 0 ? 1 : -1) * (2000 + i) * 100),
      saldo: null,
      referencia: null,
    }));

    const inicio = performance.now();
    sugerirMatches(lineas, movs, { toleranciaDias: 3, maxCombinacion: 4 });
    const duracionMs = performance.now() - inicio;

    expect(duracionMs).toBeLessThan(1000);
  });
});
