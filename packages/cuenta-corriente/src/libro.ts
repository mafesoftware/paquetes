/**
 * Libro de la cuenta corriente de una cuenta (débitos: cuotas liquidadas,
 * notas de débito, intereses; créditos: cobros, notas de crédito,
 * bonificaciones), con su saldo corrido, en moneda original.
 */
import type { Moneda } from "@mafesoftware/plata-ar";

export type TipoMovimientoLibro = "cuota" | "documento_ajuste" | "bonificacion" | "cobro" | "nota_credito";

/** Un movimiento SIN saldo corrido todavía (lo calcula `construirLibro`). */
export type MovimientoLibro = {
  fecha: string; // YYYY-MM-DD
  tipo: TipoMovimientoLibro;
  concepto: string;
  moneda: Moneda;
  debitoCentavos: bigint;
  creditoCentavos: bigint;
  referenciaId: string;
};

export type FilaLibro = MovimientoLibro & { saldoCorridoCentavos: bigint };

/**
 * Ordena los movimientos por fecha (a igual fecha, débitos antes que
 * créditos — lo que generó la deuda antes de lo que la canceló el mismo
 * día; a igual tipo, se conserva el orden de entrada) y calcula el saldo
 * corrido llevando UN acumulador POR MONEDA (un movimiento en USD nunca
 * mueve el acumulado de ARS).
 */
export function construirLibro(movimientos: readonly MovimientoLibro[]): FilaLibro[] {
  const ordenados = movimientos
    .map((movimiento, indiceOriginal) => ({ movimiento, indiceOriginal }))
    .sort((a, b) => {
      if (a.movimiento.fecha !== b.movimiento.fecha) return a.movimiento.fecha < b.movimiento.fecha ? -1 : 1;
      const ordenA = a.movimiento.debitoCentavos > 0n ? 0 : 1;
      const ordenB = b.movimiento.debitoCentavos > 0n ? 0 : 1;
      if (ordenA !== ordenB) return ordenA - ordenB;
      return a.indiceOriginal - b.indiceOriginal;
    });

  const saldos = new Map<Moneda, bigint>();
  return ordenados.map(({ movimiento }) => {
    const previo = saldos.get(movimiento.moneda) ?? 0n;
    const saldoCorridoCentavos = previo + movimiento.debitoCentavos - movimiento.creditoCentavos;
    saldos.set(movimiento.moneda, saldoCorridoCentavos);
    return { ...movimiento, saldoCorridoCentavos };
  });
}

/** Saldo final por moneda (Σ débitos − créditos) — coincide con el último `saldoCorridoCentavos` de `construirLibro` para cada moneda. */
export function saldoPorMoneda(movimientos: readonly MovimientoLibro[]): Partial<Record<Moneda, bigint>> {
  const saldos: Partial<Record<Moneda, bigint>> = {};
  for (const m of movimientos) {
    saldos[m.moneda] = (saldos[m.moneda] ?? 0n) + m.debitoCentavos - m.creditoCentavos;
  }
  return saldos;
}
