/**
 * Aprobación simple de una orden de pago a un proveedor: requiere un
 * permiso de aprobación por encima de un monto configurable. PURA: sin DB,
 * sin framework.
 */

/** ¿Esta OP necesita aprobación antes de pagarse? `umbralCentavos: null` = sin umbral configurado, nunca hace falta. Estrictamente POR ENCIMA del umbral (igual al umbral no exige). */
export function requiereAprobacion(totalCentavos: bigint, umbralCentavos: bigint | null): boolean {
  if (umbralCentavos === null) return false;
  return totalCentavos > umbralCentavos;
}

export type EstadoOrdenPago = "borrador" | "pendiente_aprobacion" | "aprobada" | "pagada" | "anulada";

/** Estado inicial de una OP recién creada, según si hace falta aprobación y si quien la crea ya tiene el permiso para aprobar. */
export function estadoInicialOp(hacenFaltaAprobacion: boolean, quienCreaPuedeAprobar: boolean): EstadoOrdenPago {
  if (!hacenFaltaAprobacion) return "aprobada";
  return quienCreaPuedeAprobar ? "aprobada" : "pendiente_aprobacion";
}
