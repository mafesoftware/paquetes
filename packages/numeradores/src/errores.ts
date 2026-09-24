/** Por qué tiró `ErrorNumeradores`. */
export type CodigoErrorNumeradores = "requiere_transaccion" | "retroceso_no_permitido";

/**
 * El único error que tira este paquete. Siempre por un error de
 * PROGRAMACIÓN (llamar `siguienteNumero` sin transacción, o pedirle a
 * `configurarNumerador` que baje el `proximo`), nunca por datos que mandó un
 * usuario.
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
 */
export class ErrorNumeradores extends Error {
  readonly codigo: CodigoErrorNumeradores;

  constructor(codigo: CodigoErrorNumeradores, mensaje: string) {
    super(mensaje);
    this.name = "ErrorNumeradores";
    this.codigo = codigo;
  }
}
