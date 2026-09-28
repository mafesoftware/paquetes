import { calcularAjuste } from "./ajuste.js";

/**
 * La diferencia de ajuste entre el valor USADO al liquidar una cuota
 * (modalidad `provisorio`/`definitivo`: el último publicado al momento del
 * cobro) y el valor DEFINITIVO que se publicó después (spec 02 §3.2,
 * modalidades provisorio/definitivo): `monto_ajustado(definitivo) -
 * monto_ajustado(usado)`, ambos calculados desde el mismo `montoBase`/
 * `valorBase`.
 *
 * Positiva si el índice definitivo terminó siendo mayor al usado (hay que
 * cobrar de más); negativa si terminó siendo menor (hay que acreditar).
 *
 * @example
 * diferenciaDeAjuste(10_000_000n, "3448.3", "3650.0", "3662.2");
 * // monto con 3650.0: 10_584_926n; con 3662.2: 10_620_306n -> diferencia 35_380n
 */
export function diferenciaDeAjuste(
  montoBase: bigint,
  valorBase: string,
  valorUsado: string,
  valorDefinitivo: string,
): bigint {
  const conValorUsado = calcularAjuste(montoBase, valorBase, valorUsado).montoAjustado;
  const conValorDefinitivo = calcularAjuste(montoBase, valorBase, valorDefinitivo).montoAjustado;
  return conValorDefinitivo - conValorUsado;
}
