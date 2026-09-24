/**
 * Errores tipados de `plata-ar`.
 *
 * Las funciones de esta versión (reparto por mayor resto, factores, suma
 * multimoneda) reciben datos que en su mayoría vienen de otro código, no de
 * lo que alguien tipeó en un formulario: una lista de pesos vacía, un peso
 * negativo, una suma de monedas distintas. Eso es un bug de quien llama, no
 * un dato inválido de usuario — así que se tira, no se devuelve `null`.
 *
 * `parsearImporte` es la excepción: lo que llega ahí sí lo tipeó una
 * persona, y por eso no tira — devuelve `{ ok: false, error }` (ver
 * `parseo.ts`).
 */

/** Categoría de un `ErrorPlata`, para que quien atrape el error decida sin parsear el mensaje. */
export type CodigoErrorPlata =
  /** `repartirPorMayorResto` con la lista de pesos vacía. */
  | "pesos_vacio"
  /** Un peso de `repartirPorMayorResto` no es un número/string/bigint decimal válido. */
  | "peso_invalido"
  /** Un peso de `repartirPorMayorResto` es negativo. */
  | "peso_negativo"
  /** Todos los pesos de `repartirPorMayorResto` son cero: no hay proporción que repartir. */
  | "pesos_todo_cero"
  /** Un factor (`aplicarFactor`, `convertir`) no es un string decimal válido de hasta 8 decimales. */
  | "factor_invalido"
  /** División por cero en `redondearComercial`. */
  | "division_por_cero"
  /** `sumar` recibió importes de monedas distintas. */
  | "moneda_mezclada"
  /** `sumar` fue llamado sin importes: no hay moneda que inferir. */
  | "sumar_sin_importes"
  /** `convertir` recibió un tipo de cambio que no es mayor a 0. */
  | "tc_no_positivo"
  /** `convertir` a la misma moneda de origen con un tipo de cambio que no es exactamente "1". */
  | "tc_identidad"
  /** `factorEntre` recibió un valor de índice que no es un decimal válido, o que no es mayor a 0 (los índices son positivos). */
  | "indice_invalido";

/** Error de `plata-ar` para condiciones que son un bug de quien llama, no un dato inválido de usuario. */
export class ErrorPlata extends Error {
  readonly codigo: CodigoErrorPlata;

  constructor(codigo: CodigoErrorPlata, mensaje: string) {
    super(mensaje);
    this.name = "ErrorPlata";
    this.codigo = codigo;
  }
}
