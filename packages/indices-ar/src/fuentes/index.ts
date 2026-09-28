/**
 * Lectores de fuentes públicas, con `fetch` INYECTADO (nunca `globalThis.fetch`
 * leído directo) — spec 02 §2/§3.1: la carga automática diaria de UVA/CER
 * (BCRA) y de cotizaciones (dolarapi.com), con respaldo manual si la fuente
 * falla. Subpath separado del núcleo porque, aunque no dependen de ningún
 * framework, SÍ hacen red (a través del `fetch` que les pasan) — el núcleo
 * (`@mafesoftware/indices-ar`) se mantiene puro.
 *
 * Ninguna de las dos funciones tira: las dos devuelven
 * `{ ok: true; valores } | { ok: false; categoria }`, para que quien llame
 * decida sin `try/catch` (spec 02 §2: "si la fuente falla, alerta en el
 * panel de plataforma y el usuario puede cargar a mano").
 */
export * from "./tipos.js";
export * from "./leer-uva-cer.js";
export * from "./leer-cotizaciones.js";
