/**
 * Dominio de proveedores para un ERP/SaaS multi-tenant argentino: totales de
 * un documento de proveedor (ítems, IVA, percepciones, validación con
 * tolerancia), prorrateo por porcentaje entre proyectos, la decisión de
 * archivar un proveedor con saldo pendiente, y el balance/aprobación de una
 * orden de pago. Núcleo puro: sin DB, sin framework, sin variables de
 * entorno — cada función entra con datos y sale con un resultado.
 *
 * Depende de `@mafesoftware/plata-ar` (redondeo comercial en `bigint`,
 * reparto por mayor resto, el tipo `Moneda`) — la aritmética de plata NO se
 * reimplementa acá.
 */
export * from "./iva.js";
export * from "./totales.js";
export * from "./prorrateo.js";
export * from "./archivar.js";
export * from "./balance-orden-pago.js";
export * from "./aprobacion-orden-pago.js";
