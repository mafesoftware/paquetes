/**
 * CSP con nonce por request, y el nonce que la acompaña.
 *
 * El nonce es lo que permite tener `script-src` sin `'unsafe-inline'` (que es
 * la directiva que de verdad frena un XSS) sin tener que enumerar cada script
 * por URL: Next.js lee el header `Content-Security-Policy` del request
 * entrante en `proxy.ts`/middleware, saca el nonce y lo pega en los scripts
 * que él mismo emite. Por eso tiene que ser distinto en cada request — un
 * nonce fijo en el código es una directiva `'unsafe-inline'` con pasos
 * extra.
 *
 * ## Por qué `nonce` y `extras` se validan (fix round 1, I5)
 *
 * La CSP se arma concatenando strings con `; ` y ` ` como separadores. Si
 * `nonce` viniera de una fuente no confiable (no debería, pero nada lo
 * impedía) y contuviera un `;`, podría cerrar la directiva `script-src` e
 * INYECTAR una directiva CSP nueva propia — el mismo patrón que una
 * inyección SQL, pero en el header que se supone que previene XSS. Lo mismo
 * con el nombre de una directiva en `extras` o con una fuente que traiga un
 * `;`, una `,` o un espacio: `politicaCsp` ahora tira `ErrorSeguridad`
 * (`codigo: "csp_invalida"`) ante cualquiera de esos casos, en vez de armar
 * una CSP corrupta en silencio.
 */
import { randomBytes } from "node:crypto";
import { ErrorSeguridad } from "../errores.js";

/** Fuentes extra por directiva, para lo que cada app necesite (un CDN de fuentes, un widget de terceros). Se agregan a las de la política base, sin pisarlas. */
export type ExtrasCsp = Record<string, string[]>;

/** Un nonce válido es lo que `generarNonce()` produce: base64 (estándar o url-safe), con o sin relleno `=` al final. Nada de `;`, `,` ni espacios. */
const NONCE_VALIDO = /^[A-Za-z0-9+/_-]+={0,2}$/;
/** Una directiva CSP es una palabra en minúsculas con guiones (`script-src`, `frame-ancestors`, ...). */
const DIRECTIVA_VALIDA = /^[a-z-]+$/;
/** Lo que NUNCA puede aparecer dentro de una fuente: son los caracteres que separan directivas/fuentes en el header. */
const CARACTER_PROHIBIDO_EN_FUENTE = /[;,\s]/;

function directivasBase(nonce: string): Array<[string, string[]]> {
  return [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["object-src", ["'none'"]],
    // Directiva "bare": no lleva fuentes, solo la palabra.
    ["upgrade-insecure-requests", []],
  ];
}

/**
 * La política completa, lista para el header `Content-Security-Policy`.
 *
 * `extras` deja agregar fuentes a una directiva existente (o agregar una
 * directiva nueva) sin reescribir la base: por ejemplo
 * `{ "style-src": ["https://fonts.googleapis.com"] }` para poder cargar una
 * hoja de estilos de Google Fonts. Las fuentes repetidas no se duplican.
 *
 * Tira `ErrorSeguridad` (`codigo: "csp_invalida"`) si `nonce` no tiene forma
 * de nonce, si el nombre de una directiva de `extras` no es
 * `[a-z-]+`, o si una fuente contiene `;`, `,` o un espacio — ver la
 * cabecera del archivo.
 */
export function politicaCsp(nonce: string, extras: ExtrasCsp = {}): string {
  if (typeof nonce !== "string" || !NONCE_VALIDO.test(nonce)) {
    throw new ErrorSeguridad(
      "csp_invalida",
      `El nonce no tiene un formato válido (esperado: base64, con o sin relleno "=" al final). Generalo con generarNonce().`,
    );
  }

  const directivas = new Map<string, string[]>(directivasBase(nonce));
  for (const [nombre, fuentes] of Object.entries(extras)) {
    if (!DIRECTIVA_VALIDA.test(nombre)) {
      throw new ErrorSeguridad(
        "csp_invalida",
        `Nombre de directiva CSP inválido: "${nombre}" (solo letras minúsculas y guiones, ej: "style-src").`,
      );
    }
    for (const fuente of fuentes) {
      if (typeof fuente !== "string" || fuente.length === 0 || CARACTER_PROHIBIDO_EN_FUENTE.test(fuente)) {
        throw new ErrorSeguridad(
          "csp_invalida",
          `Fuente CSP inválida en "${nombre}": ${JSON.stringify(fuente)} (no puede tener ";", "," ni espacios — eso permite inyectar una directiva CSP nueva).`,
        );
      }
    }
    const actuales = directivas.get(nombre) ?? [];
    const nuevas = fuentes.filter((fuente) => !actuales.includes(fuente));
    directivas.set(nombre, [...actuales, ...nuevas]);
  }
  return [...directivas.entries()]
    .map(([nombre, fuentes]) => (fuentes.length > 0 ? `${nombre} ${fuentes.join(" ")}` : nombre))
    .join("; ");
}

/** Un nonce de request: 16 bytes al azar, en base64. */
export function generarNonce(): string {
  return randomBytes(16).toString("base64");
}
