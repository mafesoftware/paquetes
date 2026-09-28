/** Cómo se liquida el ajuste de una cuota (spec 02 §3.2). */
export type ModalidadAjuste =
  /** Se usa el último índice publicado al liquidar; queda firme, no se corrige nunca. */
  | "disponible"
  /** Se liquida con el último publicado; la diferencia con el definitivo se agrega a la próxima cuota. */
  | "provisorio"
  /** Se liquida con el último publicado como anticipo; la diferencia se emite como documento de ajuste aparte. */
  | "definitivo";

/** Lo que corresponde hacer cuando se publica el valor DEFINITIVO de un período. */
export type AccionAlPublicarDefinitivo =
  /** `disponible` con la cuota ya cobrada: quedó firme, no se toca. */
  | "nada"
  /** La cuota todavía no se cobró: se recalcula con el valor definitivo (spec 02 §3.2: "recalcula cuotas no cobradas"). */
  | "recalcular"
  /** `provisorio` con la cuota ya cobrada: la diferencia se agrega a la próxima cuota. */
  | "diferencia_proxima_cuota"
  /** `definitivo` con la cuota ya cobrada: se emite un documento de ajuste aparte. */
  | "documento_ajuste";

/**
 * Qué hacer cuando se publica el valor DEFINITIVO de un período, para una
 * cuota que ajusta con `modalidad` (spec 02 §3.2 y §3.2 "Regenerar
 * ajustes"): una cuota **no cobrada** SIEMPRE se recalcula con el valor
 * definitivo — nunca se reescribe una cuota cobrada. Para una cuota YA
 * cobrada, lo que corresponde depende de la modalidad con la que se liquidó.
 *
 * @example
 * accionAlPublicarDefinitivo("disponible", true); // "nada"
 * @example
 * accionAlPublicarDefinitivo("provisorio", true); // "diferencia_proxima_cuota"
 * @example
 * accionAlPublicarDefinitivo("definitivo", true); // "documento_ajuste"
 * @example
 * accionAlPublicarDefinitivo("definitivo", false); // "recalcular": no cobrada, sin importar la modalidad
 */
export function accionAlPublicarDefinitivo(
  modalidad: ModalidadAjuste,
  cuotaCobrada: boolean,
): AccionAlPublicarDefinitivo {
  if (!cuotaCobrada) return "recalcular";

  switch (modalidad) {
    case "disponible":
      return "nada";
    case "provisorio":
      return "diferencia_proxima_cuota";
    case "definitivo":
      return "documento_ajuste";
  }
}
