import { timingSafeEqual } from "node:crypto";

/**
 * Compara dos secretos sin filtrar por cuánto tiempo tarda cuántos caracteres
 * coinciden.
 *
 * `a === b` sale del `Buffer` de comparación de V8 apenas encuentra el primer
 * byte distinto — más rápido cuanto antes difieren. Para un token de sesión o
 * un secreto de cron, eso es un canal lateral: medir el tiempo de muchos
 * intentos deja reconstruir el secreto byte a byte. `timingSafeEqual` cierra
 * eso, pero solo compara buffers del MISMO largo (tira si difieren) — por
 * eso el chequeo de largo va antes, y compararlo no es el problema: el largo
 * de un secreto no es el secreto.
 *
 * Centraliza lo que `compararEnTiempoConstante` en `carnet-qr` y variantes
 * locales en store360/distrigo/alquileres-app reimplementaban cada uno por su
 * lado (ver el brief de esta tarea).
 *
 * ## Tres reglas de seguridad, no solo de tipos
 *
 * - **No-string es `false`.** `null`/`undefined`/`number` no son secretos
 *   válidos: tratarlos como `""` (como hacía una versión anterior de esta
 *   función, con `String(a ?? "")`) hacía que
 *   `compararEnTiempoConstante(undefined, "")` diera `true` — un secreto no
 *   configurado "coincidiendo" con un valor vacío es exactamente el bypass
 *   que esta función existe para evitar.
 * - **Vacío de cualquier lado es `false`, incluso `("", "")`.** Un secreto
 *   real nunca es la cadena vacía; que dos vacíos den "true" acá no tiene
 *   ningún uso legítimo y sí sirve de salida de emergencia para un secreto
 *   mal inicializado. Por eso esta función NO es un `a === b` genérico — es
 *   una comparación de SECRETOS, y ahí la cadena vacía nunca es una
 *   coincidencia válida.
 * - **UTF-16, no UTF-8.** El encoder UTF-8 de Node reemplaza cualquier
 *   surrogate suelto (la mitad de un par, inválido por sí solo) por el mismo
 *   carácter de reemplazo U+FFFD (bytes `EF BF BD`). Eso significa que dos
 *   strings JS DISTINTOS —con surrogates sueltos distintos, o uno con un
 *   surrogate suelto y otro con un U+FFFD literal— podían terminar
 *   codificando a los MISMOS bytes UTF-8 y compararse iguales sin serlo
 *   (`"a\uD800"` vs. `"a�"`). `utf16le` vuelca cada code unit tal cual,
 *   sin sustituciones: es una función inyectiva de string a bytes, así que
 *   dos strings distintos (incluso con surrogates sueltos) nunca producen
 *   el mismo buffer.
 */
export function compararEnTiempoConstante(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || b.length === 0) return false;
  const ba = Buffer.from(a, "utf16le");
  const bb = Buffer.from(b, "utf16le");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
