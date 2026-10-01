/**
 * Compras de obra: pedidos (requisiciones), cuadro comparativo de
 * cotizaciones y órdenes de compra. Núcleo puro: sin DB, sin framework, sin
 * `process.env` — toda cantidad física es un `Cantidad` (decimal como
 * `string`, hasta 4 decimales, nunca `number` cuando multiplica un precio) y
 * toda plata es `bigint` en centavos.
 *
 * - `cantidad.ts`: `Cantidad` y su aritmética (`multiplicar`,
 *   `sumarCantidades`, `restarCantidades`, `compararCantidades`,
 *   `menorCantidad`, `porcentajeDe`) — la usan todos los demás módulos;
 *   se re-exporta para que la app arme sus propios cálculos con el mismo
 *   criterio.
 * - `pedidos.ts`: ciclo de vida de un pedido de compra (requisición) —
 *   `transicionPedido`, `transicionADestino`, `pendienteDeItem`,
 *   `pedidoQuedoComprado`.
 * - `comparativo.ts`: `armarComparativo` — cuadro comparativo de
 *   cotizaciones de varios proveedores contra los ítems de un pedido.
 * - `ordenes-compra.ts`: ciclo de vida de una orden de compra
 *   (`transicionOrdenCompra`) y sus totales (`totalesOrdenCompra`, con
 *   IVA por ítem).
 *
 * Recepción de mercadería (remitos), conciliación de 3 vías, acopios y
 * alertas de desvío son parte del dominio de compras pero todavía no tienen
 * lógica PURA propia en Obriq (solo código acoplado a su DB) — no hay nada
 * genérico que extraer de ahí todavía; se agregan a este paquete cuando esa
 * lógica nazca pura del lado de la app, siguiendo el mismo criterio que
 * `cantidad.ts`/`pedidos.ts`/`comparativo.ts`/`ordenes-compra.ts`.
 *
 * Este paquete no trae tabla de Drizzle (no hay subpath `/drizzle`): no hay
 * ninguna parte con DB que extraer todavía — a diferencia de una cola
 * genérica como `@mafesoftware/outbox`, que sí tiene una tabla común.
 */
export * from "./cantidad.js";
export * from "./pedidos.js";
export * from "./comparativo.js";
export * from "./ordenes-compra.js";
