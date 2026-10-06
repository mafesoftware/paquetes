import { describe, expect, it } from "vitest";
import { construirLibro, saldoPorMoneda, type MovimientoLibro } from "../src/libro.js";

function mov(parcial: Partial<MovimientoLibro> & Pick<MovimientoLibro, "fecha" | "moneda">): MovimientoLibro {
  return {
    tipo: "cuota",
    concepto: "",
    debitoCentavos: 0n,
    creditoCentavos: 0n,
    referenciaId: "",
    ...parcial,
  };
}

describe("construirLibro", () => {
  it("saldo corrido: cuota liquidada (débito) → cobro (crédito) → bonificación (crédito), en orden", () => {
    const filas = construirLibro([
      mov({ fecha: "2026-02-15", moneda: "ARS", tipo: "cuota", debitoCentavos: 100_000n, referenciaId: "c1" }),
      mov({ fecha: "2026-02-20", moneda: "ARS", tipo: "cobro", creditoCentavos: 60_000n, referenciaId: "cob1" }),
      mov({ fecha: "2026-02-25", moneda: "ARS", tipo: "bonificacion", creditoCentavos: 5_000n, referenciaId: "b1" }),
    ]);

    expect(filas.map((f) => f.saldoCorridoCentavos)).toEqual([100_000n, 40_000n, 35_000n]);
  });

  it("cada moneda lleva su propio saldo corrido, independiente de la otra", () => {
    const filas = construirLibro([
      mov({ fecha: "2026-02-10", moneda: "ARS", debitoCentavos: 100_000n, referenciaId: "ars-1" }),
      mov({ fecha: "2026-02-11", moneda: "USD", debitoCentavos: 500_00n, referenciaId: "usd-1" }),
      mov({ fecha: "2026-02-12", moneda: "ARS", debitoCentavos: 50_000n, referenciaId: "ars-2" }),
      mov({ fecha: "2026-02-13", moneda: "USD", tipo: "cobro", creditoCentavos: 200_00n, referenciaId: "usd-cobro" }),
    ]);

    const ars = filas.filter((f) => f.moneda === "ARS");
    const usd = filas.filter((f) => f.moneda === "USD");
    expect(ars.map((f) => f.saldoCorridoCentavos)).toEqual([100_000n, 150_000n]);
    expect(usd.map((f) => f.saldoCorridoCentavos)).toEqual([500_00n, 300_00n]);
  });

  it("movimientos cargados en orden DESCENDENTE de fecha: igual se ordenan cronológicamente", () => {
    const filas = construirLibro([
      mov({ fecha: "2026-02-20", moneda: "ARS", tipo: "cuota", debitoCentavos: 50_000n, referenciaId: "segundo-en-fecha" }),
      mov({ fecha: "2026-02-10", moneda: "ARS", tipo: "cuota", debitoCentavos: 100_000n, referenciaId: "primero-en-fecha" }),
    ]);

    expect(filas.map((f) => f.referenciaId)).toEqual(["primero-en-fecha", "segundo-en-fecha"]);
    expect(filas.map((f) => f.saldoCorridoCentavos)).toEqual([100_000n, 150_000n]);
  });

  it("a igual fecha y mismo tipo de movimiento (ambos débitos), conserva el orden de entrada", () => {
    const filas = construirLibro([
      mov({ fecha: "2026-03-01", moneda: "ARS", tipo: "cuota", debitoCentavos: 30_000n, referenciaId: "primero" }),
      mov({ fecha: "2026-03-01", moneda: "ARS", tipo: "documento_ajuste", debitoCentavos: 4_000n, referenciaId: "segundo" }),
    ]);

    expect(filas.map((f) => f.referenciaId)).toEqual(["primero", "segundo"]);
    expect(filas.map((f) => f.saldoCorridoCentavos)).toEqual([30_000n, 34_000n]);
  });

  it("a igual fecha, los débitos se ordenan antes que los créditos", () => {
    const filas = construirLibro([
      mov({ fecha: "2026-03-01", moneda: "ARS", tipo: "cobro", creditoCentavos: 10_000n, referenciaId: "credito" }),
      mov({ fecha: "2026-03-01", moneda: "ARS", tipo: "cuota", debitoCentavos: 30_000n, referenciaId: "debito" }),
    ]);

    expect(filas.map((f) => f.referenciaId)).toEqual(["debito", "credito"]);
    expect(filas.map((f) => f.saldoCorridoCentavos)).toEqual([30_000n, 20_000n]);
  });

  it("una nota de débito (documento_ajuste) es un débito más, en la fecha de SU propio vencimiento", () => {
    const filas = construirLibro([
      mov({ fecha: "2026-01-15", moneda: "ARS", tipo: "cuota", debitoCentavos: 100_000n, referenciaId: "cuota-1" }),
      mov({ fecha: "2026-01-25", moneda: "ARS", tipo: "documento_ajuste", debitoCentavos: 4_000n, referenciaId: "nd-1" }),
    ]);
    expect(filas.map((f) => f.saldoCorridoCentavos)).toEqual([100_000n, 104_000n]);
  });
});

describe("saldoPorMoneda", () => {
  it("coincide con el último saldoCorridoCentavos de construirLibro para cada moneda", () => {
    const movimientos = [
      mov({ fecha: "2026-02-10", moneda: "ARS", debitoCentavos: 100_000n, referenciaId: "ars-1" }),
      mov({ fecha: "2026-02-11", moneda: "USD", debitoCentavos: 500_00n, referenciaId: "usd-1" }),
      mov({ fecha: "2026-02-13", moneda: "USD", tipo: "cobro", creditoCentavos: 200_00n, referenciaId: "usd-cobro" }),
    ];
    expect(saldoPorMoneda(movimientos)).toEqual({ ARS: 100_000n, USD: 300_00n });
  });

  it("sin movimientos → objeto vacío", () => {
    expect(saldoPorMoneda([])).toEqual({});
  });
});
