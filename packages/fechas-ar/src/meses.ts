/**
 * Aritmética de meses segura para cuotas: sumar un mes al 31 no puede tirar
 * ni desbordar al mes siguiente ("2026-01-31" + 1 mes NO es "2026-03-03").
 *
 * Es la cuenta que necesita un plan de pagos: la cuota 2 vence "un mes
 * después" de la 1, en el mismo día del mes cuando existe, y si no, en el
 * último día de ese mes — nunca corrida al mes de al lado.
 */

import { ErrorFecha } from "./errores.js";
import { aMesesTotales, deMesesTotales, diasEnMes, pad2, pad4, validarFechaISO } from "./interno.js";

/**
 * Suma `n` meses (negativo resta, `0` devuelve el mismo mes) a `fecha`, y fija
 * el día resultante en `dia`.
 *
 * `dia` es el día de mes QUE SE QUIERE (1..31, típicamente el día de
 * vencimiento del plan), no el día de `fecha` — para eso ya está `fecha`
 * misma. Si el mes resultante no llega a tener ese día (30 de febrero), se
 * usa el último día real de ese mes: nunca se desborda al mes siguiente. Con
 * `"ultimo"` siempre da el último día del mes resultante, sin importar el día
 * de `fecha`.
 *
 * @example
 * sumarMeses("2026-01-31", 1, 31); // "2026-02-28" (2026 no es bisiesto)
 * @example
 * sumarMeses("2028-01-31", 1, 31); // "2028-02-29" (2028 sí lo es)
 * @example
 * sumarMeses("2026-01-15", 2, "ultimo"); // "2026-03-31"
 */
export function sumarMeses(fecha: string, n: number, dia: number | "ultimo"): string {
  const { anio, mes } = validarFechaISO(fecha);
  validarDiaObjetivo(dia);

  const { anio: anioResultado, mes: mesResultado } = deMesesTotales(aMesesTotales(anio, mes) + n);
  const ultimoDiaDelMes = diasEnMes(anioResultado, mesResultado);
  const diaResultado = dia === "ultimo" ? ultimoDiaDelMes : Math.min(dia, ultimoDiaDelMes);

  return `${pad4(anioResultado)}-${pad2(mesResultado)}-${pad2(diaResultado)}`;
}

function validarDiaObjetivo(dia: number | "ultimo"): void {
  if (dia === "ultimo") return;
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    throw new ErrorFecha("dia_invalido", `Día objetivo inválido: ${JSON.stringify(dia)} (se espera 1..31 o "ultimo")`);
  }
}
