/**
 * Índices de ajuste argentinos (spec 02 §3): CAC, ICC, UVA, CER, IPC, ICL —
 * factores de ajuste, período de referencia, las tres modalidades
 * (disponible/provisorio/definitivo), topes, polinómicas y saldo en
 * puntos-índice. Núcleo puro: sin DB, sin framework, sin variables de entorno.
 *
 * Depende de `@mafesoftware/plata-ar` (>=0.2: `factorEntre`/`aplicarFactor`
 * para la aritmética de factores en `bigint`, nunca reimplementada acá) y de
 * `@mafesoftware/fechas-ar` (>=0.2: `Periodo`/`sumarPeriodos` para el
 * desfase de período).
 *
 * `/drizzle` (peerDependency opcional `drizzle-orm`) trae `tablaIndices`,
 * `tablaValoresIndice`, `tablaCotizaciones` y `valorVigente`. `/fuentes`
 * trae lectores de fuentes públicas (BCRA para UVA/CER, dolarapi.com para
 * cotizaciones) con `fetch` inyectado — nunca tiran, devuelven un resultado
 * categorizado.
 */

export * from "./errores.js";
export * from "./ajuste.js";
export * from "./periodo-referencia.js";
export * from "./diferencia.js";
export * from "./modalidad.js";
export * from "./tope.js";
export * from "./polinomica.js";
export * from "./puntos.js";
