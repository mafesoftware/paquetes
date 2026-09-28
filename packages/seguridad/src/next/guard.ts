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
 *
 * ## `next/navigation` se carga PEREZOSO (fix round 1, M10)
 *
 * `autorizarCron`, `cabecerasSeguridad`, `politicaCsp` e `ipDe` no necesitan
 * Next para nada — son funciones que reciben un `Request`/`Headers` estándar
 * y devuelven strings/booleans. Si este archivo importara `next/navigation`
 * arriba de todo (como antes del fix), cualquier app que importe
 * `@mafesoftware/seguridad/next` SOLO por esas cuatro funciones se llevaba
 * puesto Next igual, porque `src/next/index.ts` reexporta todo desde el
 * mismo módulo — con `next` sin instalar (es un peerDependency OPCIONAL),
 * eso rompe en tiempo de carga. El `import("next/navigation.js")` de acá
 * abajo es dinámico y vive DENTRO del `catch`: solo se evalúa cuando `guard`
 * de verdad se usa y de verdad hace falta decidir si un error es un
 * redirect/notFound. Ver `tests/next/sin-next-estatico.test.ts`, que
 * verifica (leyendo el código fuente, no ejecutándolo) que ningún archivo de
 * `src/next/` importa `next` de forma estática salvo este `import()`.
 *
 * Si ESE `import()` tira (fix P.C: `next` roto o ausente en un caso donde
 * igual se llegó a llamar `guard`), no hay `unstable_rethrow` que invocar —
 * pero el error del import NUNCA reemplaza al error ORIGINAL que tiró `fn`:
 * se relanza el original tal cual, sin convertirlo en `{ ok: false }` (no se
 * pudo verificar si era un `redirect`/`notFound`) ni dejar que el error del
 * import lo tape.
 */

/** Marca de reconocimiento cruzada entre copias del paquete (ver `esErrorNegocio` más abajo). */
const MARCA_ERROR_NEGOCIO = Symbol.for("@mafesoftware/seguridad:ErrorNegocio");

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
    // `Symbol.for(...)` devuelve `symbol`, no `unique symbol`: TS no deja
    // usarlo como nombre de propiedad computado en la declaración de la
    // clase (solo en una asignación como esta, con un cast puntual).
    (this as unknown as Record<symbol, unknown>)[MARCA_ERROR_NEGOCIO] = true;
  }
}

/**
 * ¿Es un `ErrorNegocio`? No alcanza con `instanceof` (fix round 1, M6): un
 * monorepo con dos copias de `@mafesoftware/seguridad` instaladas (una
 * transitiva de otra dependencia, con versión distinta) tiene DOS clases
 * `ErrorNegocio` que no son `instanceof` la una de la otra aunque el código
 * fuente sea idéntico — un problema clásico de Node con paquetes duplicados.
 * `Symbol.for(...)` resuelve al MISMO símbolo del registro global sin
 * importar desde qué copia del paquete se llame, así que sirve de marca
 * cruzada. Se exige junto con `error.name === "ErrorNegocio"` (no la marca
 * sola) para no confundir un objeto cualquiera que por casualidad tenga esa
 * property con el error real.
 */
function esErrorNegocio(error: unknown): error is ErrorNegocio {
  if (error instanceof ErrorNegocio) return true;
  if (!(error instanceof Error) || error.name !== "ErrorNegocio") return false;
  const marcado = (error as unknown as Record<PropertyKey, unknown>)[MARCA_ERROR_NEGOCIO] === true;
  return marcado && typeof (error as unknown as { mensaje?: unknown }).mensaje === "string";
}

/**
 * ¿Es un objeto plano (`{...}`, literal o `Object.create(null)`)? Un array,
 * `null`, una instancia de clase (`Date`, `Map`, un modelo de ORM) o un
 * primitivo NO lo son.
 */
function esObjetoPlano(valor: unknown): valor is Record<string, unknown> {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return false;
  const proto = Object.getPrototypeOf(valor);
  return proto === Object.prototype || proto === null;
}

// `T extends undefined | void`, no solo `undefined`: una acción declarada
// `async () => { /* nada */ }` infiere `Promise<void>`, no `Promise<undefined>`
// — y `void` no cae en la rama `undefined` de un tipo condicional aunque en
// tiempo de ejecución la función devuelva `undefined` igual. Sin el `| void`
// acá, `guard(async () => {})` tipaba `{ ok: true; valor: void }` (pidiendo
// una propiedad `valor` que en runtime nunca está), rompiendo exactamente el
// caso más común de action sin body de retorno.
type ResultadoOk<T> = T extends undefined | void
  ? { ok: true }
  : T extends readonly unknown[]
    ? { ok: true; valor: T }
    : T extends object
      ? { ok: true } & T
      : { ok: true; valor: T };
type ResultadoError = { ok: false; error: string; campo?: string };

/** Lo que devuelve una función envuelta con `guard`. */
export type ResultadoGuard<T> = ResultadoOk<T> | ResultadoError;

/**
 * Envuelve una server action.
 *
 * - Si `fn` no devuelve nada (`undefined`), el resultado es `{ ok: true }`.
 * - Si `fn` devuelve un objeto PLANO (`{...}`), se mezcla en
 *   `{ ...resultado, ok: true }` — con `ok` AL FINAL (fix round 1, M6), para
 *   que un `resultado` que por accidente (o por un bug de quien llama) traiga
 *   su propia clave `ok` nunca pise el `true` real. Las claves `error`/
 *   `campo` de `resultado` (si las trae) se DESCARTAN antes de mezclar (fix
 *   P.C): son las mismas claves que usa la rama `ok: false` de acá abajo, así
 *   que dejarlas pasar en un resultado EXITOSO confundiría a quien consume
 *   `guard()`.
 * - Si `fn` devuelve un array o un primitivo (string, number, boolean, ...),
 *   se envuelve como `{ ok: true, valor: resultado }` — nunca se spreadea un
 *   array o un primitivo directo en el resultado (fix round 1, M6): eso daría
 *   claves numéricas (`"0"`, `"1"`, ...) o ninguna clave útil, respectivamente.
 * - Si tira `ErrorNegocio` (de ESTA copia del paquete o de otra —
 *   `esErrorNegocio` lo detecta igual), se convierte en
 *   `{ ok: false, error: mensaje, campo? }`.
 * - `redirect()`/`notFound()` se vuelven a tirar (ver la cabecera del
 *   archivo): nunca llegan a convertirse en `{ ok: false }`.
 * - Cualquier otro error (un bug) se vuelve a tirar tal cual: `guard` no es
 *   un manejador de errores genérico, solo de los esperables.
 */
export function guard<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<ResultadoGuard<T>> {
  return async (...args: Args) => {
    try {
      const resultado = await fn(...args);
      if (resultado === undefined) return { ok: true } as ResultadoGuard<T>;
      if (esObjetoPlano(resultado)) {
        // Fix P.C: si `resultado` trae sus propias claves "error"/"campo"
        // (un bug de quien llama, o un objeto que por casualidad las usa
        // para otra cosa), no pueden colarse en un resultado EXITOSO — eso
        // confundiría a quien consume `guard()` (que espera `error`/`campo`
        // únicamente en la rama `ok: false`). Se descartan ANTES del
        // spread, nunca después: poner `ok: true` al final ya evita que
        // pisen `ok`, pero por sí solo no las saca del objeto.
        const { error: _error, campo: _campo, ...limpio } = resultado as Record<string, unknown>;
        return { ...limpio, ok: true } as ResultadoGuard<T>;
      }
      return { ok: true, valor: resultado } as ResultadoGuard<T>;
    } catch (error) {
      // Fix P.C: si el import perezoso mismo FALLA (`next` no instalado, o
      // roto de cualquier otra forma), no hay `unstable_rethrow` que llamar
      // — pero el error de ESE import nunca puede pisar el error ORIGINAL
      // que tiró `fn`: quien llama tiene que ver la causa real de su propio
      // bug, no un "Cannot find module next/navigation" que la tapa.
      let unstableRethrow: (error: unknown) => void;
      try {
        ({ unstable_rethrow: unstableRethrow } = await import("next/navigation.js"));
      } catch {
        throw error;
      }
      unstableRethrow(error);
      if (esErrorNegocio(error)) {
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
