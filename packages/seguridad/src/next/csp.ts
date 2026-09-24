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
 */
import { randomBytes } from "node:crypto";

/** Fuentes extra por directiva, para lo que cada app necesite (un CDN de fuentes, un widget de terceros). Se agregan a las de la política base, sin pisarlas. */
export type ExtrasCsp = Record<string, string[]>;

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
 */
export function politicaCsp(nonce: string, extras: ExtrasCsp = {}): string {
  const directivas = new Map<string, string[]>(directivasBase(nonce));
  for (const [nombre, fuentes] of Object.entries(extras)) {
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
