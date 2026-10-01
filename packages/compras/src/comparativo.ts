/**
 * Cuadro comparativo de cotizaciones de un pedido de compra. PURA, sin DB —
 * quien llama carga las respuestas de cotización desde su base y le pasa la
 * forma cruda a `armarComparativo`.
 *
 * Regla de "mejor": precio más bajo gana; empate de precio → gana el de
 * menor plazo (`plazoDias`); un proveedor que no cotizó un ítem queda con
 * celda vacía (`null`) y no puede ganar ese ítem. `mejorTotal` es el
 * proveedor con el total más bajo entre los que cotizaron algo (Σ de
 * `subtotal` por proveedor, celdas vacías cuentan `0`). `mejorCombinado` es
 * la suma del `subtotal` del ganador de CADA ítem por separado (nunca mayor
 * al mejor total de un solo proveedor).
 */
import { multiplicar, type Cantidad } from "./cantidad.js";

/** Lo mínimo que necesita un ítem del pedido para calcular su subtotal por proveedor. */
export type ItemComparativo = { id: string; cantidad: Cantidad };

/** Una fila cruda de respuesta de cotización, ya filtrada a las recibidas (una rechazada no entra al cuadro). */
export type RespuestaComparativo = {
  proveedorId: string;
  itemId: string;
  /** Centavos. */
  precio: bigint;
  plazoDias: number;
  condiciones: string | null;
};

export type CeldaComparativo = { precio: bigint; plazoDias: number; condiciones: string | null; subtotal: bigint };

export type FilaComparativo = {
  itemId: string;
  porProveedor: Record<string, CeldaComparativo | null>;
  /** `null` si ningún proveedor cotizó este ítem. */
  mejor: string | null;
};

export type CuadroComparativo = {
  filas: FilaComparativo[];
  totales: Record<string, bigint>;
  /** `null` si nadie cotizó nada. */
  mejorTotal: string | null;
  mejorCombinado: bigint;
};

/** `true` si `candidato` es mejor que el mejor actual: precio más bajo, o mismo precio con menor plazo. */
function esMejor(candidato: { precio: bigint; plazoDias: number }, actual: { precio: bigint; plazoDias: number } | null): boolean {
  if (!actual) return true;
  if (candidato.precio !== actual.precio) return candidato.precio < actual.precio;
  return candidato.plazoDias < actual.plazoDias;
}

export function armarComparativo(items: readonly ItemComparativo[], proveedorIds: readonly string[], respuestas: readonly RespuestaComparativo[]): CuadroComparativo {
  const porItem = new Map<string, Map<string, RespuestaComparativo>>();
  for (const r of respuestas) {
    if (!porItem.has(r.itemId)) porItem.set(r.itemId, new Map());
    porItem.get(r.itemId)!.set(r.proveedorId, r);
  }

  const totales: Record<string, bigint> = Object.fromEntries(proveedorIds.map((p) => [p, 0n]));
  const filas: FilaComparativo[] = [];

  for (const item of items) {
    const respuestasItem = porItem.get(item.id);
    const porProveedor: Record<string, CeldaComparativo | null> = {};
    let mejorProveedorId: string | null = null;
    let mejorCelda: { precio: bigint; plazoDias: number } | null = null;

    for (const proveedorId of proveedorIds) {
      const r = respuestasItem?.get(proveedorId);
      if (!r) {
        porProveedor[proveedorId] = null;
        continue;
      }
      const subtotal = multiplicar(item.cantidad, r.precio);
      porProveedor[proveedorId] = { precio: r.precio, plazoDias: r.plazoDias, condiciones: r.condiciones, subtotal };
      totales[proveedorId] = (totales[proveedorId] ?? 0n) + subtotal;

      if (esMejor(r, mejorCelda)) {
        mejorCelda = { precio: r.precio, plazoDias: r.plazoDias };
        mejorProveedorId = proveedorId;
      }
    }

    filas.push({ itemId: item.id, porProveedor, mejor: mejorProveedorId });
  }

  const proveedoresQueCotizaron = new Set(respuestas.map((r) => r.proveedorId));
  let mejorTotal: string | null = null;
  let mejorTotalValor: bigint | null = null;
  for (const proveedorId of proveedorIds) {
    if (!proveedoresQueCotizaron.has(proveedorId)) continue;
    const t = totales[proveedorId] ?? 0n;
    if (mejorTotalValor === null || t < mejorTotalValor) {
      mejorTotalValor = t;
      mejorTotal = proveedorId;
    }
  }

  const mejorCombinado = filas.reduce((acc, fila) => {
    if (!fila.mejor) return acc;
    const celda = fila.porProveedor[fila.mejor];
    return celda ? acc + celda.subtotal : acc;
  }, 0n);

  return { filas, totales, mejorTotal, mejorCombinado };
}
