/**
 * Por qué falló algo contra Mercado Pago. La categoría no es decoración: es lo
 * que le permite a la ruta del webhook elegir entre responder 200 (no
 * reintentes, no va a cambiar) y 500 (reintentá, esto fue pasajero).
 */
export type CategoriaErrorMP =
  /** Token vencido o revocado, client_id/secret mal. Reintentar no arregla. */
  | "credenciales"
  /** MP no contestó, cortó, o devolvió 5xx. Reintentar puede arreglar. */
  | "red"
  /** MP dice que el recurso no existe. */
  | "no_encontrado"
  /** MP entendió y dijo que no (4xx que no es 401 ni 404). */
  | "rechazado"
  /** La firma del webhook no valida. */
  | "firma";

export class ErrorMP extends Error {
  readonly categoria: CategoriaErrorMP;
  readonly estadoHttp?: number;
  readonly detalle?: string;

  constructor(
    categoria: CategoriaErrorMP,
    mensaje: string,
    opciones?: { estadoHttp?: number; detalle?: string; cause?: unknown }
  ) {
    super(mensaje, opciones?.cause ? { cause: opciones.cause } : undefined);
    this.name = "ErrorMP";
    this.categoria = categoria;
    this.estadoHttp = opciones?.estadoHttp;
    this.detalle = opciones?.detalle;
  }
}

/**
 * ¿Conviene que Mercado Pago reintente este aviso?
 *
 * Solo lo pasajero. Un error que no es `ErrorMP` es un bug nuestro y también
 * cuenta como transitorio: preferimos que MP reintente a perder el aviso de un
 * pago que la clienta ya hizo.
 */
export function esTransitorio(error: unknown): boolean {
  if (error instanceof ErrorMP) return error.categoria === "red";
  return true;
}
