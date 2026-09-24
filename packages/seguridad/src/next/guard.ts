/**
 * Envoltorio para server actions: convierte un error de negocio en un
 * resultado (`{ ok: false, error, campo? }`) en vez de dejarlo escapar como
 * una excepción que en producción se ve como "An error occurred in the
 * Server Components render" sin ningún detalle útil. Puerto de `guard()` en
 * `src/app/actions.ts` de distrigo, generalizado.
 *
 * `redirect()` y `notFound()` de Next.js funcionan tirando una excepción
 * especial que el framework atrapa más arriba — si este `guard` la tragara
 * como un error de negocio cualquiera, ROMPERÍA la navegación (redirect) o
 * el 404 (notFound). `unstable_rethrow` es la forma que da el propio Next de
 * decir "esto no es mío, no lo captures": mira el error y, si es una de esas
 * excepciones de control de flujo (o page de "usar sin encontrar" con
 * `cause` anidado), lo vuelve a tirar tal cual. Va ANTES del `catch` de
 * `ErrorNegocio`.
 *
 * `unstable_rethrow` no necesita un server de Next corriendo: es una función
 * pura que mira propiedades del error (`digest`, `cause`) — se puede llamar
 * en un test con un error armado a mano, o con el que devuelven las propias
 * `redirect()`/`notFound()` importadas de `next/navigation`.
 */
// `next`, tal cual publica su `package.json`, no tiene un mapa "exports": la
// resolución ESM estricta de Node (y la de TS bajo "moduleResolution":
// "nodenext", que es la que usa este monorepo) exige entonces la extensión
// explícita para un subpath — "next/navigation" a secas falla con
// `ERR_MODULE_NOT_FOUND` en Node real, aunque en un `create-next-app`
// (que usa "moduleResolution": "bundler", mucho más laxa) no se note.
import { unstable_rethrow } from "next/navigation.js";

/** Un error esperable de negocio: algo que la UI le muestra a quien usa la app, no un bug. */
export class ErrorNegocio extends Error {
  readonly mensaje: string;
  /** Qué campo del formulario señalar, si aplica. */
  readonly campo?: string;

  constructor(mensaje: string, campo?: string) {
    super(mensaje);
    this.name = "ErrorNegocio";
    this.mensaje = mensaje;
    this.campo = campo;
  }
}

type ResultadoOk<T> = T extends object ? { ok: true } & T : { ok: true };
type ResultadoError = { ok: false; error: string; campo?: string };

/** Lo que devuelve una función envuelta con `guard`. */
export type ResultadoGuard<T> = ResultadoOk<T> | ResultadoError;

/**
 * Envuelve una server action.
 *
 * - Si `fn` resuelve, el resultado (si es un objeto) se mezcla en
 *   `{ ok: true, ...resultado }`; si no devuelve nada, `{ ok: true }`.
 * - Si tira `ErrorNegocio`, se convierte en
 *   `{ ok: false, error: mensaje, campo? }`.
 * - `redirect()`/`notFound()` se vuelven a tirar (ver arriba): nunca llegan a
 *   convertirse en `{ ok: false }`.
 * - Cualquier otro error (un bug) se vuelve a tirar tal cual: `guard` no es
 *   un manejador de errores genérico, solo de los esperables.
 */
export function guard<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<ResultadoGuard<T>> {
  return async (...args: Args) => {
    try {
      const resultado = await fn(...args);
      const extra = resultado !== null && typeof resultado === "object" ? resultado : {};
      return { ok: true, ...extra } as ResultadoGuard<T>;
    } catch (error) {
      unstable_rethrow(error);
      if (error instanceof ErrorNegocio) {
        return {
          ok: false,
          error: error.mensaje,
          ...(error.campo !== undefined ? { campo: error.campo } : {}),
        };
      }
      throw error;
    }
  };
}
