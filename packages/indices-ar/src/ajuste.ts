import { aplicarFactor, factorEntre } from "@mafesoftware/plata-ar";

/** Lo que devuelve `calcularAjuste`. */
export interface ResultadoAjuste {
  /** `valorRef / valorBase`, 8 decimales (spec 02 §3.2). */
  factor: string;
  /** `montoBase` con el factor aplicado, redondeado comercial al centavo. */
  montoAjustado: bigint;
  /** `montoAjustado - montoBase`. Negativo si `valorRef < valorBase` (deflación). */
  ajuste: bigint;
}

/**
 * El ajuste de una cuota por índice (spec 02 §3.2):
 *
 * ```
 * factor         = índice_referencia / índice_base   (8 decimales)
 * monto_ajustado = redondear(monto_base × factor)
 * ajuste         = monto_ajustado − monto_base
 * ```
 *
 * Delega el cálculo exacto en `@mafesoftware/plata-ar`: `factorEntre`
 * (la razón, a 8 decimales) y `aplicarFactor` (el monto ajustado, redondeo
 * comercial al centavo). Este paquete no reimplementa esa aritmética.
 *
 * `valorBase`/`valorRef` son valores de ÍNDICE (no factores ya calculados):
 * aceptan cualquier cantidad de decimales — tira `ErrorPlata`
 * (`indice_invalido`) si alguno no es un decimal válido o no es mayor a 0
 * (los índices son positivos).
 *
 * @example
 * calcularAjuste(10_000_000n, "3448.3", "3662.2");
 * // { factor: "1.06203057", montoAjustado: 10_620_306n, ajuste: 620_306n }
 * @example
 * calcularAjuste(10_000_000n, "100", "100"); // factor "1": ajuste 0n
 * @example
 * calcularAjuste(10_000_000n, "100", "90");
 * // valorRef < valorBase: factor "0.9", ajuste NEGATIVO (-1_000_000n)
 */
export function calcularAjuste(montoBase: bigint, valorBase: string, valorRef: string): ResultadoAjuste {
  const factor = factorEntre(valorRef, valorBase);
  const montoAjustado = aplicarFactor(montoBase, factor);
  return { factor, montoAjustado, ajuste: montoAjustado - montoBase };
}
