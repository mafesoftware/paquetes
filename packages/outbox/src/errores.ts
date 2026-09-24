/** Por qué tiró `ErrorOutbox`. */
export type CodigoErrorOutbox = "requiere_transaccion" | "opciones_invalidas";

/**
 * El único error que tira este paquete. Siempre por un error de
 * PROGRAMACIÓN (llamar `encolar` sin transacción, o pasarle a una función
 * de configuración — `backoff`, `tablaOutbox`, `procesarOutbox`,
 * `transporteCorreo`, `transporteWhatsApp` — opciones que no tienen
 * sentido), nunca por datos que mandó un usuario final ni por un fallo de
 * transporte (eso vuelve como resultado categorizado, nunca como
 * excepción — ver `clasificarResultado`).
 *
 * `codigo` distingue el motivo sin parsear el mensaje:
 * - `"requiere_transaccion"`: `encolar` se llamó con un `db` que no es una
 *   transacción. El mensaje solo se debe encolar si la transacción del
 *   hecho de negocio que lo dispara confirma — fuera de una transacción,
 *   un rollback posterior en el mismo flujo dejaría un mensaje encolado
 *   sin el hecho que lo justifica.
 * - `"opciones_invalidas"`: una opción de configuración no tiene sentido
 *   (ej. `backoff` con `factor < 1`, `procesarOutbox` con `lote <= 0`,
 *   `transporteCorreo`/`transporteWhatsApp` sin las funciones que
 *   necesitan inyectadas).
 */
export class ErrorOutbox extends Error {
  readonly codigo: CodigoErrorOutbox;

  constructor(codigo: CodigoErrorOutbox, mensaje: string) {
    super(mensaje);
    this.name = "ErrorOutbox";
    this.codigo = codigo;
  }
}
