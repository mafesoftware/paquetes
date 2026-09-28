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
 * **Solo para el caso SIN tope.** Si el contrato tiene `topePct` (y/o
 * `soloPositivo`), usar `diferenciaDeAjusteConTope` en su lugar: restar los
 * montos ajustados completos acá, sin capar cada lado por separado antes,
 * puede dar un crédito o cargo que el tope ya había evitado — por ejemplo,
 * un provisorio capado al 15% (índice +20%) y un definitivo en +18%
 * (todavía por encima del 15%) dan acá una diferencia de -2% que se lee
 * como un crédito, cuando la cuota nunca cobró más del 15% real y no hay
 * nada que devolver.
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
