/** Por qué tiró `ErrorLimiteIntentos`. */
export type CodigoErrorLimiteIntentos = "opciones_invalidas";

/**
 * El único error que tira este paquete. Siempre por un error de
 * PROGRAMACIÓN (una clave vacía, o una opción numérica —`maximo`,
 * `ventanaMs`, `bloqueoMs`— que no es un entero finito positivo), nunca por
 * datos que mandó quien intenta iniciar sesión: el freno de fuerza bruta no
 * debe poder tumbarse pasándole un dato de usuario raro.
 *
 * `codigo` distingue el motivo sin parsear el mensaje. Hoy solo existe
 * `"opciones_invalidas"` — a diferencia de `@mafesoftware/outbox`/
 * `@mafesoftware/numeradores`, este paquete NO exige transacción (ver el
 * JSDoc de `registrarIntento`), así que no hay un código
 * `"requiere_transaccion"`.
 */
export class ErrorLimiteIntentos extends Error {
  readonly codigo: CodigoErrorLimiteIntentos;

  constructor(codigo: CodigoErrorLimiteIntentos, mensaje: string) {
    super(mensaje);
    this.name = "ErrorLimiteIntentos";
    this.codigo = codigo;
  }
}
