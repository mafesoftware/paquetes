/**
 * Error tipado de la API 0.2 (`periodo.ts`, `meses.ts`, `habiles.ts`).
 *
 * Toda función de esas tres que trabaja con `"YYYY-MM-DD"`/`"YYYY-MM"`
 * recibe strings que en la práctica vienen de otro código (una fecha
 * calculada, un período guardado), no de lo que alguien tipeó en un
 * formulario. Un `"2026-02-30"` o un `"2026-13"` ahí es un bug de quien
 * llama, así que se tira en vez de devolver `null` o `NaN` silencioso.
 */

/** Categoría de un `ErrorFecha`, para que quien atrape el error decida sin parsear el mensaje. */
export type CodigoErrorFecha =
  /** El string no tiene la forma `"YYYY-MM-DD"` (o `"YYYY-MM"` para un `Periodo`). */
  | "formato_invalido"
  /** El formato es correcto pero el calendario no: mes fuera de 1..12, o día que no existe en ese mes/año (`"2026-02-30"`). */
  | "fecha_invalida"
  /** El `dia` pedido a `sumarMeses` no es un entero 1..31 ni `"ultimo"`. */
  | "dia_invalido";

/** Error de `fechas-ar` para condiciones que son un bug de quien llama, no un dato inválido de usuario. */
export class ErrorFecha extends Error {
  readonly codigo: CodigoErrorFecha;

  constructor(codigo: CodigoErrorFecha, mensaje: string) {
    super(mensaje);
    this.name = "ErrorFecha";
    this.codigo = codigo;
  }
}
