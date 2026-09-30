/**
 * Decisiones de negocio sobre una caja/cuenta de tesorería: si un egreso
 * puede registrarse dado el saldo actual, y si una fecha de movimiento está
 * bloqueada por el último cierre vigente.
 */

export type DecisionEgreso = { ok: true } | { ok: false; error: string; saldoDisponible: bigint };

/**
 * ¿Se puede registrar un egreso de `importeCentavos` sobre una caja con
 * `saldoActual`? Si la caja no puede quedar negativa (`permiteNegativo:
 * false`) y el egreso supera el saldo, devuelve un error claro con el saldo
 * disponible. Una caja con `permiteNegativo: true` siempre puede.
 */
export function decidirEgreso(saldoActual: bigint, importeCentavos: bigint, permiteNegativo: boolean): DecisionEgreso {
  if (permiteNegativo || importeCentavos <= saldoActual) return { ok: true };
  return {
    ok: false,
    error: "Saldo insuficiente en la caja para este egreso.",
    saldoDisponible: saldoActual,
  };
}

/**
 * ¿Esta fecha de movimiento está bloqueada por el último cierre VIGENTE de
 * la caja? Un cierre bloquea su propia fecha y cualquier fecha anterior —
 * un movimiento con fecha posterior al cierre no está bloqueado, y se
 * cargaría sobre un período ya cerrado sin este chequeo. Comparación
 * lexicográfica de `YYYY-MM-DD` == comparación cronológica.
 *
 * `fechaUltimoCierre: null` = la caja nunca se cerró, nunca bloquea.
 */
export function fechaBloqueadaPorCierre(fechaMovimiento: string, fechaUltimoCierre: string | null): boolean {
  if (fechaUltimoCierre === null) return false;
  return fechaMovimiento <= fechaUltimoCierre;
}
