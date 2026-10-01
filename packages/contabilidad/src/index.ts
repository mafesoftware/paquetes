/**
 * Motor de contabilidad por partida doble — núcleo PURO (sin DB, sin
 * framework). Plan de cuentas, asientos balanceados, mapeo de cuentas,
 * libros (diario/mayor/sumas y saldos/balance/resultados), períodos
 * contables, refundición de cuentas de resultado y ajuste por inflación
 * RT 6. Ver el README para un ejemplo de cada función exportada.
 */

export * from "./plan-cuentas.js";
export * from "./asiento.js";
export * from "./mapeos.js";
export * from "./reportes.js";
export * from "./periodos.js";
export * from "./refundicion.js";
export * from "./rt6.js";
