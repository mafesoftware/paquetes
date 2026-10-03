/**
 * Costo promedio ponderado de stock, diferencia de inventario físico y
 * alertas de reposición. Núcleo puro: sin DB, sin framework, sin
 * `process.env` — saldos y cantidades entran siempre por parámetro.
 *
 * Depende de `@mafesoftware/plata-ar` (`redondearComercial` para la
 * aritmética de `Cantidad`, nunca reimplementada acá).
 *
 * - **`costoPromedio` / `ingresoAValorFijo` / `egresoAPromedio` / `egresoAValorFijo` /
 *   `costoUnitarioDivision`**: el saldo de un material en un almacén
 *   (cantidad + valor), cómo lo mezcla un ingreso (costo promedio
 *   ponderado, CPP) y cómo sale un egreso — al costo promedio vigente o a
 *   un valor fijo (reversión de una operación anterior).
 * - **`diferenciaInventario`**: la diferencia (faltante/sobrante) de un
 *   conteo físico contra el sistema, valorizada al costo promedio
 *   vigente.
 * - **`bajoMinimo`**: si una cantidad disponible está bajo su punto de
 *   reposición configurado.
 *
 * Las tablas de almacenes/movimientos de stock (qué se guarda, qué FKs
 * tiene, a qué proyecto/rubro de presupuesto se asocia) son específicas de
 * cada producto — no hay una parte de DB genérica para extraer acá.
 */

export type { Cantidad } from "./cantidades.js";
export { costoPromedio, ingresoAValorFijo, costoUnitarioDivision, egresoAPromedio, egresoAValorFijo, restarCantidad, compararCantidad, type SaldoStock, type ResultadoEgreso } from "./costo-promedio.js";
export { diferenciaInventario, bajoMinimo, type DiferenciaInventario } from "./inventario.js";
