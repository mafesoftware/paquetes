import { redondearComercial } from "@mafesoftware/plata-ar";
import { ErrorIndices } from "./errores.js";
import { aBigIntConSigno, analizarDecimal, formatearDecimal } from "./decimal.js";

const ESCALA_PUNTOS = 8;

/**
 * El saldo de un boleto, en "unidades índice" (spec 02 §3.2, "Saldo en
 * puntos-índice"): `saldo / valorBase`, como string decimal de 8 decimales.
 *
 * Es el inverso de `saldoDesdePuntos` (`puntos × valorActual = saldo`):
 * junto con `saldoDesdePuntos`, sirve para mostrar "cuánto vale hoy" un
 * saldo congelado en puntos de índice, sin volver a tocar `montoBase`.
 *
 * `valorBase` tiene que ser un decimal positivo (los índices lo son); si no,
 * tira `ErrorIndices("indice_invalido")`.
 *
 * @example
 * puntosIndice(10_000_000n, "3448.3"); // "2899.97970014" (redondeado a 8 decimales)
 * @example
 * puntosIndice(3_448_300n, "3448.3"); // "1000" (exacto: 3.448.300 / 3448,3 = 1000 puntos)
 */
export function puntosIndice(saldo: bigint, valorBase: string): string {
  const base = analizarDecimal(valorBase, "puntosIndice: valorBase");
  if (base.negativo || base.valorAbs === 0n) {
    throw new ErrorIndices(
      "indice_invalido",
      `puntosIndice: "valorBase" (${valorBase}) tiene que ser un valor de índice positivo.`,
    );
  }

  // puntos = saldo / (valorAbs / 10^escala) = saldo * 10^escala / valorAbs,
  // redondeado comercial a ESCALA_PUNTOS decimales: se escala el numerador
  // un ESCALA_PUNTOS extra ANTES de dividir, para que el cociente entero
  // resultante sea directamente el valor a esa escala.
  const numerador = saldo * 10n ** BigInt(base.escala + ESCALA_PUNTOS);
  const puntosEscalados = redondearComercial(numerador, base.valorAbs);
  return formatearDecimal(puntosEscalados, ESCALA_PUNTOS);
}

/**
 * El saldo (en centavos) que corresponde a `puntos` puntos-índice al valor
 * ACTUAL del índice (spec 02 §3.2: "su valor a hoy: puntos × último
 * índice"). Inverso de `puntosIndice`.
 *
 * `valorActual` tiene que ser un decimal positivo; si no, tira
 * `ErrorIndices("indice_invalido")`. El resultado se redondea comercial al
 * centavo — por eso `saldoDesdePuntos(puntosIndice(saldo, v), v)` puede
 * diferir de `saldo` en, a lo sumo, un centavo (mismo tipo de ida-y-vuelta
 * no garantizada exacta que documenta `convertir` en `plata-ar`).
 *
 * @example
 * saldoDesdePuntos("1000", "3448.3"); // 3_448_300n
 * @example
 * saldoDesdePuntos("2899.97970014", "3448.3"); // 10_000_000n (la vuelta exacta de puntosIndice de arriba)
 */
export function saldoDesdePuntos(puntos: string, valorActual: string): bigint {
  const puntosDecimal = analizarDecimal(puntos, "saldoDesdePuntos: puntos");
  const valor = analizarDecimal(valorActual, "saldoDesdePuntos: valorActual");
  if (valor.negativo || valor.valorAbs === 0n) {
    throw new ErrorIndices(
      "indice_invalido",
      `saldoDesdePuntos: "valorActual" (${valorActual}) tiene que ser un valor de índice positivo.`,
    );
  }

  const producto = aBigIntConSigno(puntosDecimal) * valor.valorAbs;
  const escalaTotal = puntosDecimal.escala + valor.escala;
  if (escalaTotal === 0) return producto;
  return redondearComercial(producto, 10n ** BigInt(escalaTotal));
}
