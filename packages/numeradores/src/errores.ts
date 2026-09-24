/** Por qué tiró `ErrorNumeradores`. */
export type CodigoErrorNumeradores =
  | "requiere_transaccion"
  | "retroceso_no_permitido"
  | "proximo_invalido"
  | "relleno_invalido";

/**
 * El único error que tira este paquete. Siempre por un error de
 * PROGRAMACIÓN (llamar `siguienteNumero` sin transacción, o pedirle a
 * `configurarNumerador` un `proximo`/`relleno` que no tiene sentido), nunca
 * por datos que mandó un usuario final.
 *
 * `codigo` distingue el motivo sin parsear el mensaje:
 * - `"requiere_transaccion"`: `siguienteNumero` se llamó con un `db` que no
 *   es una transacción (`db.transaction(async (tx) => ...)` sin usar `tx`
 *   adentro). El número solo se puede consumir si la transacción que lo pide
 *   confirma — fuera de una transacción, un error después de numerar dejaría
 *   el número gastado sin ningún comprobante.
 * - `"retroceso_no_permitido"`: `configurarNumerador` intentó bajar
 *   `proximo` por debajo del valor actual, lo que generaría números
 *   repetidos con los que ya se emitieron.
 * - `"proximo_invalido"`: `configurarNumerador` recibió un `proximo` menor
 *   a `1n` — no hay número de comprobante `0` o negativo.
 * - `"relleno_invalido"`: `configurarNumerador` recibió un `relleno` que no
 *   es un entero `>= 0`.
 */
export class ErrorNumeradores extends Error {
  readonly codigo: CodigoErrorNumeradores;

  constructor(codigo: CodigoErrorNumeradores, mensaje: string) {
    super(mensaje);
    this.name = "ErrorNumeradores";
    this.codigo = codigo;
  }
}
