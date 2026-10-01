/**
 * Ciclo de vida de un pedido de compra (requisición): la solicitud interna
 * que después se cotiza y se compra. PURA, sin DB.
 *
 * `borrador → enviado → aprobado | rechazado → cotizando →
 * comprado_parcial → comprado → cerrado`, con `rechazado` reenviable a
 * `enviado` (el pedido SÍ tiene estado propio de rechazo, editable/
 * reenviable — a diferencia de la orden de compra, que vuelve directo a
 * `borrador`, ver `ordenesCompra.ts`).
 *
 * El evento `"comprar"` no tiene un destino fijo en la tabla: depende de si,
 * tras registrar la compra, queda algo pendiente en algún ítem — lo decide
 * quien llama, con `pedidoQuedoComprado`, y se lo pasa a
 * `transicionPedido(..., "comprar", { pendienteCero })`.
 */
import { restarCantidades, type Cantidad } from "./cantidad.js";

export type EstadoPedido =
  | "borrador"
  | "enviado"
  | "aprobado"
  | "rechazado"
  | "cotizando"
  | "comprado_parcial"
  | "comprado"
  | "cerrado";

export type EventoPedido = "enviar" | "aprobar" | "rechazar" | "reenviar" | "cotizar" | "comprar" | "cerrar";

type EventoManual = Exclude<EventoPedido, "comprar">;

const TRANSICIONES: Record<EstadoPedido, Partial<Record<EventoManual, EstadoPedido>>> = {
  borrador: { enviar: "enviado" },
  enviado: { aprobar: "aprobado", rechazar: "rechazado" },
  aprobado: { cotizar: "cotizando" },
  rechazado: { reenviar: "enviado" },
  cotizando: {},
  comprado_parcial: { cerrar: "cerrado" },
  comprado: { cerrar: "cerrado" },
  cerrado: {},
};

/** Los eventos administrativos (todos salvo `"comprar"`), en el orden en que se prueban al resolver un destino de kanban (`transicionADestino`). */
const EVENTOS_MANUALES: readonly EventoManual[] = ["enviar", "aprobar", "rechazar", "reenviar", "cotizar", "cerrar"];

/**
 * La transición de un pedido ante un evento, o un `Error` si no es válido en
 * ese estado (nunca tira). `"comprar"` solo es válido desde
 * `cotizando`/`comprado_parcial`, y su destino (`comprado` vs
 * `comprado_parcial`) depende de `opciones.pendienteCero` (ej.: "OC de 850
 * ladrillos contra un pedido de 1.000 → `comprado_parcial` con pendiente
 * 150; OC por el resto → `comprado`").
 */
export function transicionPedido(estado: EstadoPedido, evento: EventoPedido, opciones?: { pendienteCero?: boolean }): EstadoPedido | Error {
  if (evento === "comprar") {
    if (estado !== "cotizando" && estado !== "comprado_parcial") {
      return new Error(`No se puede "comprar" un pedido en estado "${estado}".`);
    }
    return opciones?.pendienteCero ? "comprado" : "comprado_parcial";
  }

  const siguiente = TRANSICIONES[estado][evento];
  if (!siguiente) return new Error(`No se puede "${evento}" un pedido en estado "${estado}".`);
  return siguiente;
}

/** Resuelve qué evento manual lleva de `estado` a `destino` (para un kanban, que arrastra a una COLUMNA, no dispara un evento con nombre) — el primero que matchea, o `Error` si ninguno. */
export function transicionADestino(estado: EstadoPedido, destino: EstadoPedido): EstadoPedido | Error {
  for (const evento of EVENTOS_MANUALES) {
    const siguiente = TRANSICIONES[estado][evento];
    if (siguiente === destino) return siguiente;
  }
  return new Error(`No se puede mover un pedido de "${estado}" a "${destino}".`);
}

/** Lo que falta comprar de un ítem: `cantidadPedida − cantidadComprada`. */
export function pendienteDeItem(cantidadPedida: Cantidad, cantidadComprada: Cantidad): Cantidad {
  return restarCantidades(cantidadPedida, cantidadComprada);
}

/**
 * `true` si ya no queda nada pendiente de comprar en NINGÚN ítem — el
 * `pendienteCero` que necesita `transicionPedido(..., "comprar", ...)`.
 */
export function pedidoQuedoComprado(items: readonly { cantidadPedida: Cantidad; cantidadComprada: Cantidad }[]): boolean {
  return items.every((item) => Number(pendienteDeItem(item.cantidadPedida, item.cantidadComprada)) <= 0);
}
