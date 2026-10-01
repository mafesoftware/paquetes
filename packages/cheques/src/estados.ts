/**
 * Estados y transiciones de un cheque — dos vocabularios DISJUNTOS según
 * `tipo`: un cheque de `tercero` (recibido de un cliente) recorre
 * `EstadoTercero`, uno `propio` (emitido contra una chequera) recorre
 * `EstadoPropio`. `transicionCheque` es la ÚNICA fuente de verdad de qué
 * transición es válida — la capa de datos de quien consume este paquete
 * nunca decide esto a mano.
 */

export type EstadoTercero = "en_cartera" | "depositado" | "acreditado" | "rechazado" | "endosado" | "descontado" | "custodia";

export type EstadoPropio = "en_blanco" | "emitido" | "debitado" | "anulado";

export type EventoCheque =
  | "depositar"
  | "acreditar"
  | "rechazar"
  | "endosar"
  | "descontar"
  | "enviar_custodia"
  | "retirar_custodia"
  | "emitir"
  | "debitar"
  | "anular"
  | "devolver_por_rechazo";

/**
 * Tabla de transiciones de un cheque de TERCERO:
 * - `en_cartera` es el estado inicial (recién recibido) y desde ahí se
 *   puede depositar, endosar, descontar o mandar a custodia;
 * - `depositado` solo se acredita o rechaza (nunca se re-deposita ni se
 *   endosa: ya está en el circuito bancario);
 * - `endosado` solo puede volver por rechazo del endosatario (el rebote de
 *   un cheque endosado revive la deuda de quien lo recibió Y la de quien
 *   lo endosó) — nunca se deposita (ya no es de quien lo tiene para
 *   depositarlo);
 * - `acreditado`, `rechazado`, `descontado` son terminales para este
 *   dominio.
 */
const TRANSICIONES_TERCERO: Readonly<Record<EstadoTercero, Partial<Readonly<Record<EventoCheque, EstadoTercero>>>>> = {
  en_cartera: {
    depositar: "depositado",
    endosar: "endosado",
    descontar: "descontado",
    enviar_custodia: "custodia",
  },
  custodia: {
    retirar_custodia: "en_cartera",
  },
  depositado: {
    acreditar: "acreditado",
    rechazar: "rechazado",
  },
  endosado: {
    devolver_por_rechazo: "rechazado",
  },
  acreditado: {},
  rechazado: {},
  descontado: {},
};

/**
 * Tabla de transiciones de un cheque PROPIO: nace `en_blanco` (chequera
 * cargada, todavía sin usar ese número), pasa a `emitido` al entregarlo y a
 * `debitado` cuando el banco lo efectiviza. `anular` desde `en_blanco` es
 * la anulación DIRECTA (número que nunca se entregó); desde `emitido`
 * también es una transición válida, para quien consume este paquete
 * decida si la expone directo o la ata a anular el hecho de negocio que lo
 * generó (ej. una orden de pago). `debitado + anular → error`: un cheque
 * que ya salió de la cuenta no se anula, se rebate por otra vía.
 */
const TRANSICIONES_PROPIO: Readonly<Record<EstadoPropio, Partial<Readonly<Record<EventoCheque, EstadoPropio>>>>> = {
  en_blanco: {
    emitir: "emitido",
    anular: "anulado",
  },
  emitido: {
    debitar: "debitado",
    anular: "anulado",
  },
  debitado: {},
  anulado: {},
};

/**
 * Aplica `evento` a un cheque `tipo` en `estado`: devuelve el estado
 * siguiente, o un `Error` (nunca tira) si la transición no es válida —
 * quien llama decide si ese `Error` se propaga o se traduce a
 * `{ ok: false, error }`.
 */
export function transicionCheque(tipo: "tercero", estado: EstadoTercero, evento: EventoCheque): EstadoTercero | Error;
export function transicionCheque(tipo: "propio", estado: EstadoPropio, evento: EventoCheque): EstadoPropio | Error;
export function transicionCheque(
  tipo: "tercero" | "propio",
  estado: EstadoTercero | EstadoPropio,
  evento: EventoCheque
): EstadoTercero | EstadoPropio | Error {
  if (tipo === "tercero") {
    const siguiente = TRANSICIONES_TERCERO[estado as EstadoTercero]?.[evento];
    if (!siguiente) return new Error(`No se puede aplicar "${evento}" a un cheque de tercero en estado "${estado}".`);
    return siguiente;
  }
  const siguiente = TRANSICIONES_PROPIO[estado as EstadoPropio]?.[evento];
  if (!siguiente) return new Error(`No se puede aplicar "${evento}" a un cheque propio en estado "${estado}".`);
  return siguiente;
}
