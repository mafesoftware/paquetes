/**
 * Hasta qué profundidad de `.cause` (y de `AggregateError.errors`) busca
 * `esChoqueDeUnico` antes de rendirse. `err` mismo cuenta como profundidad 0.
 */
const PROFUNDIDAD_MAXIMA = 10;

/**
 * ¿Es `error` (en cualquier punto de su cadena) un choque de índice único de
 * Postgres (`23505`, `unique_violation`)?
 *
 * Se mira `code`, no el texto del mensaje: el mensaje viene traducido según
 * la configuración regional del servidor, y comparar contra `"duplicate
 * key"` falla en una base en español sin que nadie lo note hasta que dos
 * transacciones chocan a la vez.
 *
 * Camina la cadena de causas (`error`, `error.cause`, `error.cause.cause`,
 * …) hasta 10 niveles: los drivers y ORMs envuelven el error original en uno
 * propio (`"Failed query: …"`) y dejan el de Postgres en `cause` — mirar
 * solo `error.code` a secas nunca encuentra el `23505` real y el reintento
 * no se dispara (pasó en producción en store360 el 24-ago-2026, con
 * `esChoqueDeUnico` mirando solo un nivel). También baja adentro de un
 * `AggregateError` (`.errors`, cada uno con su propia cadena de `cause`):
 * `Promise.any`/algunos drivers agrupan ahí varios intentos, y el `23505`
 * útil puede estar en cualquiera de ellos, no en el primero.
 */
export function esChoqueDeUnico(error: unknown): boolean {
  return tieneCodigo(error, "23505", 0);
}

function tieneCodigo(error: unknown, codigo: string, profundidad: number): boolean {
  if (profundidad > PROFUNDIDAD_MAXIMA) return false;
  if (error === null || typeof error !== "object") return false;

  if ((error as { code?: unknown }).code === codigo) return true;

  if (error instanceof AggregateError) {
    for (const interno of error.errors) {
      if (tieneCodigo(interno, codigo, profundidad + 1)) return true;
    }
  }

  const causa = (error as { cause?: unknown }).cause;
  if (causa === undefined) return false;
  return tieneCodigo(causa, codigo, profundidad + 1);
}
