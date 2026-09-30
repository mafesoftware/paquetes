/**
 * El ciclo de una rendición de gastos: cargado → aprobado → repuesto (o
 * rechazado, desde cargado o aprobado). Solo se avanza en este orden, nunca
 * se salta un paso.
 */

export type EstadoRendicion = "cargado" | "aprobado" | "rechazado" | "repuesto";

/** Solo se aprueba una rendición recién cargada. */
export function puedeAprobarRendicion(estado: EstadoRendicion): boolean {
  return estado === "cargado";
}

/** Se puede rechazar una rendición cargada o ya aprobada, pero no una ya rechazada o repuesta. */
export function puedeRechazarRendicion(estado: EstadoRendicion): boolean {
  return estado === "cargado" || estado === "aprobado";
}

/** Solo se repone (se devuelve la plata) una rendición ya aprobada. */
export function puedeReponerRendicion(estado: EstadoRendicion): boolean {
  return estado === "aprobado";
}
