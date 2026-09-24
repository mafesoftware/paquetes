/** Por qué tiró `ErrorTenant`. Hoy solo hay un motivo; el tipo deja lugar a más sin romper a quien ya hace `switch`. */
export type CodigoErrorTenant = "dominio_base_invalido";

/**
 * El único error que tira este paquete. Siempre por un error de
 * PROGRAMACIÓN (un `dominioBase` mal configurado), nunca por datos que
 * mandó un usuario — esos casos devuelven `null`, no tiran (ver
 * `slugDeHost`, `resolverTenant`).
 *
 * `codigo` distingue el tipo de problema sin parsear el mensaje.
 */
export class ErrorTenant extends Error {
  readonly codigo: CodigoErrorTenant;

  constructor(codigo: CodigoErrorTenant, mensaje: string) {
    super(mensaje);
    this.name = "ErrorTenant";
    this.codigo = codigo;
  }
}
