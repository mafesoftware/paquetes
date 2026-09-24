/**
 * Condición frente al IVA. El código es lo que se guarda y lo que decide la
 * letra de una factura; el nombre es solo para mostrar.
 */

export type CodigoCondicionIva =
  | "responsable_inscripto"
  | "monotributo"
  | "exento"
  | "consumidor_final"
  | "no_alcanzado";

export interface CondicionIva {
  codigo: CodigoCondicionIva;
  nombre: string;
  /**
   * El id numérico que usa ARCA para esta condición en el campo "Condición
   * IVA Receptor" de la factura electrónica, cuando se conoce con certeza.
   * Ausente en vez de adivinado: un id de ARCA equivocado en una factura es
   * peor que no tenerlo, porque el organismo lo acepta igual y el error
   * aparece recién en una inspección.
   */
  idArca?: number;
}

/**
 * Las condiciones frente al IVA más comunes en un comercio argentino, con su
 * `idArca` cuando se pudo verificar con certeza.
 *
 * @example
 * CONDICIONES_IVA.find((c) => c.codigo === "monotributo");
 * // { codigo: "monotributo", nombre: "Monotributo", idArca: 6 }
 */
export const CONDICIONES_IVA: readonly CondicionIva[] = [
  { codigo: "responsable_inscripto", nombre: "Responsable Inscripto", idArca: 1 },
  { codigo: "monotributo", nombre: "Monotributo", idArca: 6 },
  { codigo: "exento", nombre: "Exento", idArca: 4 },
  { codigo: "consumidor_final", nombre: "Consumidor Final", idArca: 5 },
  // idArca: 15 confirmado contra la tabla `FEParamGetCondicionIvaReceptor`
  // del web service WSFEv1 de ARCA (factura electrónica): 1 Responsable
  // Inscripto, 4 Exento, 5 Consumidor Final, 6 Monotributo, 15 No
  // Alcanzado. A diferencia de los cuatro de arriba, no lo tenía verificado
  // al escribir este archivo por primera vez, así que había quedado sin
  // `idArca` — se agrega ahora que se confirmó contra esa tabla.
  { codigo: "no_alcanzado", nombre: "No Alcanzado", idArca: 15 },
] as const;
