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
 */
export function compararEnTiempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
