/**
 * Errores tipados de `indices-ar`.
 *
 * Igual que en `plata-ar`/`fechas-ar`: lo que llega acá en su mayoría ya lo
 * calculó otro código (un período, un peso de polinómica, un valor de
 * índice guardado), no lo tipeó una persona — un dato roto es un bug de
 * quien llama, así que se tira en vez de devolver `null`/`NaN` silencioso.
 *
 * `factorEntre`/`aplicarFactor` (de `@mafesoftware/plata-ar`) y
 * `periodoDe`/`sumarPeriodos` (de `@mafesoftware/fechas-ar`) siguen tirando
 * SUS propios errores (`ErrorPlata`/`ErrorFecha`) cuando la validación es de
 * ellos — este paquete no los reenvuelve, para no duplicar la lógica que ya
 * validan.
 */

/** Categoría de un `ErrorIndices`, para que quien atrape el error decida sin parsear el mensaje. */
export type CodigoErrorIndices =
  /** `regla.meses` de `periodoReferencia` no es un entero >= 0. */
  | "regla_invalida"
  /** Un valor de índice (`puntosIndice`/`saldoDesdePuntos`) no es un decimal válido, o no es mayor a 0. */
  | "indice_invalido"
  /** Un decimal (peso, porcentaje) no tiene forma de decimal válido. */
  | "valor_invalido"
  /** Un peso de `valorPolinomica` es negativo. */
  | "peso_invalido"
  /** `valorPolinomica` recibió una lista de componentes vacía. */
  | "polinomica_vacia"
  /** Los pesos de `valorPolinomica` no suman 1 (tolerancia ±1e-8). */
  | "pesos_no_suman_uno";

/** Error de `indices-ar` para condiciones que son un bug de quien llama, no un dato inválido de usuario. */
export class ErrorIndices extends Error {
  readonly codigo: CodigoErrorIndices;

  constructor(codigo: CodigoErrorIndices, mensaje: string) {
    super(mensaje);
    this.name = "ErrorIndices";
    this.codigo = codigo;
  }
}
