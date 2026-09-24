import { codigoEnCadena } from "./codigo-en-cadena.js";

/**
 * ¿Es `error` (en cualquier punto de su cadena) un choque de índice único de
 * Postgres (`23505`, `unique_violation`)?
 *
 * `siguienteNumero` de este mismo paquete NO produce este error: su
 * `INSERT ... ON CONFLICT DO UPDATE` maneja el conflicto adentro de la
 * misma sentencia, así que nunca llega a violar el índice único (ver su
 * JSDoc — el fallo real de `siguienteNumero` bajo concurrencia con
 * aislamiento `REPEATABLE READ`/`SERIALIZABLE` es `esFallaDeSerializacion`,
 * no esto). `esChoqueDeUnico` sigue siendo útil para el patrón MÁS VIEJO de
 * "calcular `max + 1` e insertar, reintentando si choca" (el de
 * `numeracion.ts` de store360, o cualquier otro insert con una clave única
 * calculada antes de escribir) — se deja exportado para ese caso.
 *
 * Camina la cadena de causas hasta 10 niveles y adentro de un
 * `AggregateError` (ver `codigo-en-cadena.ts`): los drivers y ORMs envuelven
 * el error original en uno propio (`"Failed query: …"`) y dejan el de
 * Postgres en `cause` — mirar solo `error.code` a secas nunca lo encuentra
 * (pasó en producción en store360 el 24-ago-2026, con la versión de
 * `esChoqueDeUnico` de ahí mirando solo un nivel).
 */
export function esChoqueDeUnico(error: unknown): boolean {
  return codigoEnCadena(error, ["23505"]);
}
