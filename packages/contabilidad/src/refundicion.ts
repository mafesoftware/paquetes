/**
 * Refundición de cuentas de resultado — dominio PURO (Tarea 4.30, spec 40,
 * `contratos.md` de Fase 4: `cerrarEjercicio` → "refundición (resultados a
 * `3.3`)"). Sin DB: recibe los SALDOS ya calculados de cada cuenta de
 * resultado (naturaleza `resultado_positivo`/`resultado_negativo`, el
 * `rubroNaturaleza` de `src/db/schema/contabilidad.ts`) y arma las líneas
 * que las cancelan contra la cuenta de resultado del ejercicio (`3.3` en el
 * plan de fábrica; el código real lo resuelve el llamador vía mapeo/plan de
 * cuentas, acá solo recibe su `cuentaId`).
 *
 * Una cuenta de resultado POSITIVO (ventas, ingresos: saldo natural en el
 * HABER) se cancela debitándola; una de resultado NEGATIVO (costos, gastos:
 * saldo natural en el DEBE) se cancela acreditándola. La diferencia neta
 * (ganancia o pérdida del ejercicio) es la contrapartida en `cuentaResultadoId`:
 * ganancia → HABER (aumenta el patrimonio); pérdida → DEBE.
 */

export type NaturalezaResultado = "resultado_positivo" | "resultado_negativo";

/** El saldo de una cuenta de resultado al cierre, en valor ABSOLUTO (siempre positivo — el signo lo decide `naturaleza`). */
export type SaldoCuentaResultado = {
  cuentaId: string;
  naturaleza: NaturalezaResultado;
  /** Valor absoluto del saldo (ARS, centavos). Una cuenta sin movimientos no se pasa (o se pasa en `0n`, que este archivo ignora). */
  saldo: bigint;
};

/** Línea simple (sin moneda/proyecto/centro de costo — el llamador la completa al armar el `Asiento` real, ver `src/lib/contabilidad/ejercicio.ts`). */
export type LineaRefundicion = { cuentaId: string; debe: bigint; haber: bigint; detalle: string };

export type ResultadoRefundicion = {
  lineas: LineaRefundicion[];
  /** Ganancia (positivo) o pérdida (negativo) del ejercicio, ARS centavos. */
  resultadoNeto: bigint;
};

/**
 * Arma las líneas de refundición: una por cada cuenta con saldo (cancelando
 * su naturaleza) más la línea de contrapartida a `cuentaResultadoId` por la
 * diferencia neta. Balancea siempre (Σ debe === Σ haber), por construcción:
 * la contrapartida es exactamente la diferencia entre lo debitado y lo
 * acreditado hasta ese punto.
 */
export function refundicionDe(saldos: readonly SaldoCuentaResultado[], cuentaResultadoId: string): ResultadoRefundicion {
  const lineas: LineaRefundicion[] = [];
  let resultadoNeto = 0n;

  for (const s of saldos) {
    if (s.saldo === 0n) continue;
    if (s.naturaleza === "resultado_positivo") {
      lineas.push({ cuentaId: s.cuentaId, debe: s.saldo, haber: 0n, detalle: "Refundición — cancelación de saldo" });
      resultadoNeto += s.saldo;
    } else {
      lineas.push({ cuentaId: s.cuentaId, debe: 0n, haber: s.saldo, detalle: "Refundición — cancelación de saldo" });
      resultadoNeto -= s.saldo;
    }
  }

  if (resultadoNeto > 0n) {
    lineas.push({ cuentaId: cuentaResultadoId, debe: 0n, haber: resultadoNeto, detalle: "Refundición — resultado del ejercicio (ganancia)" });
  } else if (resultadoNeto < 0n) {
    lineas.push({ cuentaId: cuentaResultadoId, debe: -resultadoNeto, haber: 0n, detalle: "Refundición — resultado del ejercicio (pérdida)" });
  }

  return { lineas, resultadoNeto };
}
