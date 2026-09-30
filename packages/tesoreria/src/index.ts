/**
 * Decisiones de negocio de tesorería: saldos de caja, transferencias entre
 * cajas (con tipo de cambio implícito cuando cambian de moneda), arqueo y el
 * ciclo de una rendición de gastos.
 *
 * **Núcleo puro** (regla 1 de diseño del monorepo): sin base de datos, sin
 * framework, sin `process.env`. Todo entra por parámetro — saldos, fechas y
 * estados en `bigint`/`string`, nunca leídos de un ORM ni de un reloj propio.
 * La orquestación con la base de datos (leer el saldo real, escribir el
 * movimiento, correr todo en una transacción) es responsabilidad de la app
 * que consume este paquete.
 */

export * from "./caja.js";
export * from "./transferencias.js";
export * from "./arqueo.js";
export * from "./rendiciones.js";
