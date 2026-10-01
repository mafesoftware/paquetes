/**
 * Diferencia de inventario físico y alertas de reposición. PURA (sin DB,
 * sin framework) — misma familia que `costo-promedio.ts`.
 *
 * Ejemplo de `diferenciaInventario`: sistema 120, contado 115 → ajuste −5 ×
 * $ 11.000 (costo promedio VIGENTE del material) = −$ 55.000 "diferencia de
 * inventario" al cerrar un conteo físico.
 */
import { multiplicar, sumarCantidades, type Cantidad } from "./cantidades.js";
import { compararCantidad } from "./costo-promedio.js";

export type DiferenciaInventario = { cantidad: Cantidad; valor: bigint };

/** `contado − sistema`, valorizada al `costoUnitario` (promedio vigente) — negativa = faltante, positiva = sobrante. */
export function diferenciaInventario(sistema: Cantidad, contado: Cantidad, costoUnitario: bigint): DiferenciaInventario {
  const sistemaTrim = sistema.trim();
  const sistemaNegado = sistemaTrim.startsWith("-") ? sistemaTrim.slice(1) : `-${sistemaTrim}`;
  const cantidad = sumarCantidades([contado, sistemaNegado]);
  return { cantidad, valor: multiplicar(cantidad, costoUnitario) };
}

/** `true` si `disponible` está bajo el punto de reposición (`disponible < puntoReposicion`) — ej.: punto de reposición 50 y stock 45 → `true`. `puntoReposicion: null` (sin alerta configurada) → siempre `false`. */
export function bajoMinimo(disponible: Cantidad, puntoReposicion: Cantidad | null): boolean {
  if (puntoReposicion === null) return false;
  return compararCantidad(disponible, puntoReposicion) < 0;
}
