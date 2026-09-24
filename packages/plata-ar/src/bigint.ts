import { ErrorPlata } from "./errores.js";

/**
 * Redondeo "comercial": medio hacia arriba, alejándose de cero.
 *
 * Es el redondeo de spec 02 §1 ("medio hacia arriba al centavo, solo al
 * final de cada cálculo"), extendido al lado negativo de la forma en que se
 * lee en un recibo: un ajuste a favor de $-2,50 redondea a $-3, no a $-2 —
 * "hacia arriba" es en valor absoluto, no en la recta numérica.
 *
 * Trabaja con la fracción exacta `num / den` en enteros: nunca pasa por
 * `number`, así que no hay error de punto flotante posible.
 *
 * @param num Numerador.
 * @param den Denominador. No puede ser `0`.
 */
export function redondearComercial(num: bigint, den: bigint): bigint {
  if (den === 0n) {
    throw new ErrorPlata("division_por_cero", "redondearComercial: el denominador no puede ser 0.");
  }

  const negativo = num < 0n !== den < 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;

  const cociente = n / d;
  const resto = n % d;
  // Mitad o más de una unidad: redondea alejándose de cero. `resto * 2n >= d`
  // evita dividir (y con eso, evita el punto flotante) para decidir el >= 0.5.
  const ajustado = resto * 2n >= d ? cociente + 1n : cociente;

  return negativo ? -ajustado : ajustado;
}
