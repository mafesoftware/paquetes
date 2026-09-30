/**
 * Estado de liquidación de una cuota: máquina de estados PURA (las
 * decisiones de transición viven acá; quien las aplica de verdad — leer el
 * índice, calcular el ajuste, escribir la fila — es responsabilidad de la
 * app que consume este paquete).
 *
 * Tres estados nada más:
 * - `pendiente`: todavía no se intentó liquidar (no venció, o venció pero
 *   no ajusta por índice y se liquida directo).
 * - `pendiente_indice`: venció y ajusta por índice, pero el valor de
 *   referencia que hace falta todavía no se publicó.
 * - `liquidada`: ya tiene su ajuste (o su "sin ajuste") calculado y
 *   guardado.
 */

export const ESTADOS_CUOTA = ["pendiente", "pendiente_indice", "liquidada"] as const;
export type EstadoCuota = (typeof ESTADOS_CUOTA)[number];

export function esEstadoCuota(x: unknown): x is EstadoCuota {
  return typeof x === "string" && (ESTADOS_CUOTA as readonly string[]).includes(x);
}

export const EVENTOS_CUOTA = ["liquidar", "faltaIndice", "reliquidar"] as const;
export type EventoCuota = (typeof EVENTOS_CUOTA)[number];

/**
 * `pendiente` → `liquidar` → `liquidada` (directo, sin ajuste o con el
 * índice ya disponible); `pendiente` → `faltaIndice` → `pendiente_indice`
 * (venció, ajusta, pero el índice no publicó); `pendiente_indice` →
 * `liquidar` → `liquidada` (ya se publicó); `liquidada` → `reliquidar` →
 * `liquidada` (recalcula sobre la misma cuota cuando se publica el
 * definitivo, no cambia de estado). Ninguna transición vuelve a
 * `pendiente`: un cálculo ya hecho no se borra.
 */
const TRANSICIONES: Record<EstadoCuota, Partial<Record<EventoCuota, EstadoCuota>>> = {
  pendiente: { liquidar: "liquidada", faltaIndice: "pendiente_indice" },
  pendiente_indice: { liquidar: "liquidada" },
  liquidada: { reliquidar: "liquidada" },
};

/** El estado destino de aplicar `evento` sobre `estado`, o un `Error` si la transición no es válida. */
export function transicionCuota(estado: EstadoCuota, evento: EventoCuota): EstadoCuota | Error {
  const destino = TRANSICIONES[estado][evento];
  if (!destino) {
    return new Error(`No se puede aplicar "${evento}" a una cuota en estado "${estado}".`);
  }
  return destino;
}
