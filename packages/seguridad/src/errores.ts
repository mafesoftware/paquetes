/**
 * El único tipo de error que tira este paquete cuando lo que falló es un
 * error de programación (una clave mal formada, un texto cifrado corrupto o
 * alterado) y no un dato de usuario a validar.
 *
 * Las funciones que SÍ reciben entrada hostil de un usuario (`verificarPase`,
 * `esUuid`, `autorizarCron`) nunca tiran: devuelven `false` o un resultado con
 * `motivo`. `ErrorSeguridad` es para lo otro — una clave de 10 bytes en vez de
 * 32, un texto cifrado con un prefijo que no existe — que es un bug de quien
 * llama, no algo que la app tenga que mostrarle a nadie.
 */
export type CodigoErrorSeguridad =
  /** La clave no tiene 32 bytes (AES-256), o no es un string en base64 estándar canónico ni un `Uint8Array`. */
  | "clave_invalida"
  /** El texto cifrado no tiene el formato `v1:<iv>:<tag>:<datos>`, algún segmento no es base64 estándar canónico, o el IV/tag no tienen el largo exacto (12/16 bytes). */
  | "formato_invalido"
  /** La clave no es la que cifró esto, o los datos fueron alterados: el tag de GCM no autentica. */
  | "autenticacion_fallida"
  /** El secreto de firma de un pase (`crearPase`) no es un string de al menos 32 caracteres. */
  | "secreto_invalido"
  /** `venceEn` (o, en general, los datos de un pase a crear) no es una fecha/epoch válida. */
  | "pase_invalido"
  /** El nonce, una directiva o una fuente de `politicaCsp` tienen caracteres que permitirían inyectar una directiva CSP nueva. */
  | "csp_invalida";

export class ErrorSeguridad extends Error {
  readonly codigo: CodigoErrorSeguridad;

  constructor(codigo: CodigoErrorSeguridad, mensaje: string, opciones?: { cause?: unknown }) {
    super(mensaje, opciones?.cause !== undefined ? { cause: opciones.cause } : undefined);
    this.name = "ErrorSeguridad";
    this.codigo = codigo;
  }
}
