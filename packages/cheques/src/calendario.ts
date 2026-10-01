/**
 * Calendario/proyección de saldo bancario: `proyeccionSaldoBancario(saldoHoy,
 * eventos, hasta)` acumula el saldo de hoy de una cuenta bancaria con los
 * cheques pendientes de cobrarse (terceros en cartera) o debitarse (propios
 * emitidos) hasta una fecha, para anticipar el saldo real futuro. Quien
 * consume este paquete arma `eventos` a partir de los cheques vigentes de la
 * cuenta antes de llamar acá — este paquete no sabe nada de la persistencia.
 */

export type EventoCalendario = {
  fecha: string; // YYYY-MM-DD
  importe: bigint; // siempre positivo — el signo lo da `tipo`
  tipo: "propio_a_debitar" | "tercero_a_cobrar";
  /** Opcional: el cheque de origen (lo completa quien arma los eventos) — no lo usa la proyección, solo identifica el evento para quien lo consume. */
  chequeId?: string;
};

export type PuntoSaldo = { fecha: string; saldo: bigint };

/**
 * Un punto por cada fecha DISTINTA con algún evento hasta `hasta`
 * (inclusive), en orden cronológico, con el saldo ACUMULADO desde
 * `saldoHoy` (ej.: banco hoy 5.000.000, tercero +2.000.000 al 15/10 →
 * 7.000.000, propio −500.000 al 30/11 → 6.500.000). Eventos posteriores a
 * `hasta` no entran en la proyección.
 */
export function proyeccionSaldoBancario(saldoHoy: bigint, eventos: readonly EventoCalendario[], hasta: string): PuntoSaldo[] {
  const porFecha = new Map<string, bigint>();
  for (const evento of eventos) {
    if (evento.fecha > hasta) continue;
    const signo = evento.tipo === "tercero_a_cobrar" ? 1n : -1n;
    porFecha.set(evento.fecha, (porFecha.get(evento.fecha) ?? 0n) + signo * evento.importe);
  }

  const fechas = [...porFecha.keys()].sort();
  let saldo = saldoHoy;
  const resultado: PuntoSaldo[] = [];
  for (const fecha of fechas) {
    saldo += porFecha.get(fecha) as bigint;
    resultado.push({ fecha, saldo });
  }
  return resultado;
}
