/**
 * Arqueo de una caja/cuenta: la diferencia entre lo que dice el sistema y lo
 * que se contó, y si esa diferencia necesita un movimiento de ajuste.
 */

/** Diferencia de un arqueo: `saldoContado - saldoSistema` (positivo = sobra, negativo = falta). */
export function diferenciaArqueo(saldoSistema: bigint, saldoContado: bigint): bigint {
  return saldoContado - saldoSistema;
}

/** ¿Esta diferencia de arqueo necesita un movimiento de ajuste? Cero no ajusta nada. */
export function requiereAjusteArqueo(diferencia: bigint): boolean {
  return diferencia !== 0n;
}
