/**
 * Interno: la máquina que comparten `esChoqueDeUnico` y
 * `esFallaDeSerializacion` para caminar la cadena de `error.cause` (y de
 * `AggregateError.errors`) buscando alguno de un set de códigos de Postgres.
 * No se exporta — cada función pública fija su propio set de códigos con un
 * nombre que dice qué significa (`esChoqueDeUnico`, no
 * "tieneAlgunCodigoDeEstos").
 */

/** Hasta qué profundidad de `.cause` (y de `AggregateError.errors`) se busca antes de rendirse. El error mismo cuenta como profundidad 0. */
const PROFUNDIDAD_MAXIMA = 10;

/**
 * ¿Tiene `error` (en cualquier punto de su cadena) un `code` que esté en
 * `codigos`?
 *
 * Se mira `code`, no el texto del mensaje: el mensaje viene traducido según
 * la configuración regional del servidor, y comparar contra el texto falla
 * en una base en español sin que nadie lo note hasta que pasa en producción.
 *
 * Camina la cadena de causas (`error`, `error.cause`, `error.cause.cause`,
 * …) hasta 10 niveles: los drivers y ORMs envuelven el error original en uno
 * propio (`"Failed query: …"`) y dejan el de Postgres en `cause` — mirar
 * solo `error.code` a secas nunca lo encuentra. También baja adentro de un
 * `AggregateError` (`.errors`, cada uno con su propia cadena de `cause`):
 * `Promise.any`/algunos drivers agrupan ahí varios intentos.
 */
export function codigoEnCadena(error: unknown, codigos: readonly string[]): boolean {
  return buscar(error, codigos, 0);
}

function buscar(error: unknown, codigos: readonly string[], profundidad: number): boolean {
  if (profundidad > PROFUNDIDAD_MAXIMA) return false;
  if (error === null || typeof error !== "object") return false;

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && codigos.includes(code)) return true;

  if (error instanceof AggregateError) {
    for (const interno of error.errors) {
      if (buscar(interno, codigos, profundidad + 1)) return true;
    }
  }

  const causa = (error as { cause?: unknown }).cause;
  if (causa === undefined) return false;
  return buscar(causa, codigos, profundidad + 1);
}
