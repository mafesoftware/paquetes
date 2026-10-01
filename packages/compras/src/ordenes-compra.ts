/**
 * Ciclo de vida y totales de una orden de compra (OC). PURA, sin DB.
 *
 * `borrador → pendiente_aprobacion → aprobada → enviada →
 * entregada_parcial → entregada → facturada → cerrada`, o `anulada`.
 *
 * Las transiciones que dependen de DATOS externos (recepciones ya cargadas
 * → `entregada_parcial`/`entregada`; anular con remitos ya recibidos →
 * error de negocio) NO viven acá — las decide la app que orquesta
 * recepciones/anulación, escribiendo el estado directo. Esta máquina cubre
 * los eventos ADMINISTRATIVOS: enviar a aprobación, aprobar/rechazar,
 * enviar al proveedor, facturar, cerrar y anular.
 */
import { redondearComercial } from "@mafesoftware/plata-ar";
import { multiplicar, type Cantidad } from "./cantidad.js";

export type EstadoOrdenCompra =
  | "borrador"
  | "pendiente_aprobacion"
  | "aprobada"
  | "enviada"
  | "entregada_parcial"
  | "entregada"
  | "facturada"
  | "cerrada"
  | "anulada";

export type EventoOrdenCompra = "enviar_aprobacion" | "aprobar" | "rechazar" | "enviar_proveedor" | "facturar" | "cerrar" | "anular";

/** Estados desde los que se puede anular (todo salvo los dos terminales). */
const ESTADOS_ANULABLES = new Set<EstadoOrdenCompra>(["borrador", "pendiente_aprobacion", "aprobada", "enviada", "entregada_parcial", "entregada", "facturada"]);

/** Estados desde los que se puede cerrar (una vez aprobada — antes no hay nada comprometido que cerrar). */
const ESTADOS_CERRABLES = new Set<EstadoOrdenCompra>(["aprobada", "enviada", "entregada_parcial", "entregada", "facturada"]);

const TRANSICIONES: Record<EstadoOrdenCompra, Partial<Record<EventoOrdenCompra, EstadoOrdenCompra>>> = {
  borrador: { enviar_aprobacion: "pendiente_aprobacion" },
  // La OC NO tiene estado propio de rechazo en el enum (a diferencia del
  // pedido, ver `pedidos.ts`): el rechazo vuelve directo a `borrador`.
  pendiente_aprobacion: { aprobar: "aprobada", rechazar: "borrador" },
  aprobada: { enviar_proveedor: "enviada" },
  enviada: {},
  entregada_parcial: {},
  entregada: { facturar: "facturada" },
  facturada: {},
  cerrada: {},
  anulada: {},
};

/**
 * La transición de una OC ante un evento administrativo, o un `Error` si no
 * es válido en ese estado. `"cerrar"`/`"anular"` no están en `TRANSICIONES`
 * (aplican desde varios estados a la vez) — se resuelven con los sets de
 * arriba.
 */
export function transicionOrdenCompra(estado: EstadoOrdenCompra, evento: EventoOrdenCompra): EstadoOrdenCompra | Error {
  if (evento === "cerrar") {
    if (!ESTADOS_CERRABLES.has(estado)) return new Error(`No se puede cerrar una orden de compra en estado "${estado}".`);
    return "cerrada";
  }
  if (evento === "anular") {
    if (!ESTADOS_ANULABLES.has(estado)) return new Error(`No se puede anular una orden de compra en estado "${estado}".`);
    return "anulada";
  }

  const siguiente = TRANSICIONES[estado][evento];
  if (!siguiente) return new Error(`No se puede "${evento}" una orden de compra en estado "${estado}".`);
  return siguiente;
}

const ESCALA_PORCENTAJE_8 = 10n ** 8n;

function escalarPorcentaje(porcentaje: string): bigint {
  const texto = porcentaje.trim();
  const negativo = texto.startsWith("-");
  const sinSigno = negativo ? texto.slice(1) : texto;
  const [entero, decimal = ""] = sinSigno.split(".");
  return (negativo ? -1n : 1n) * (BigInt(entero || "0") * ESCALA_PORCENTAJE_8 + BigInt((decimal + "0".repeat(8)).slice(0, 8)));
}

/** `centavos × porcentaje%`, redondeo comercial (medio hacia arriba). */
function pctDeImporte(centavos: bigint, porcentaje: string): bigint {
  return redondearComercial(centavos * escalarPorcentaje(porcentaje), ESCALA_PORCENTAJE_8 * 100n);
}

export type ItemTotalOc = { cantidad: Cantidad; precio: bigint; alicuotaIva: string };

export type TotalesOrdenCompra = {
  /** Σ `cantidad × precio` de todos los ítems, SIN IVA. */
  subtotal: bigint;
  /** Σ IVA por ítem (cada uno con su propia alícuota — una OC puede tener ítems a distinta alícuota). */
  iva: bigint;
  /** `subtotal + iva`. */
  total: bigint;
};

/** Totales de una OC a partir de sus ítems — para validar antes de persistir (nunca persistir un total ya calculado aparte) y para el PDF. */
export function totalesOrdenCompra(items: readonly ItemTotalOc[]): TotalesOrdenCompra {
  let subtotal = 0n;
  let iva = 0n;
  for (const item of items) {
    const subtotalItem = multiplicar(item.cantidad, item.precio);
    subtotal += subtotalItem;
    iva += pctDeImporte(subtotalItem, item.alicuotaIva);
  }
  return { subtotal, iva, total: subtotal + iva };
}
