/**
 * Las cabeceras de seguridad que no dependen del request (a diferencia de la
 * CSP, que lleva un nonce distinto cada vez — ver `csp.ts`). Se aplican
 * igual en cualquier respuesta HTML.
 */
export function cabecerasSeguridad(): Record<string, string> {
  return {
    // El navegador no "adivina" el tipo de un archivo por su contenido: usa
    // el que declaró el servidor. Sin esto, un .txt subido por un usuario
    // que empieza con `<script>` se puede llegar a ejecutar como HTML.
    "X-Content-Type-Options": "nosniff",
    // Manda origen (no la URL completa) a otros sitios, y nada al bajar de
    // https a http.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Nadie nos mete en un <iframe> ajeno (clickjacking). Redundante con
    // `frame-ancestors 'none'` de la CSP, pero cubre navegadores viejos que
    // no la leen.
    "X-Frame-Options": "DENY",
    // Ninguna página de la app pide cámara, micrófono ni geolocalización.
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    // 2 años (63072000s) + subdominios + apto para la lista de precarga de
    // los navegadores: fuerza https incluso antes del primer request.
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  };
}
