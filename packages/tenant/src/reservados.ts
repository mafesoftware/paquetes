/**
 * Los subdominios que NO son organizaciones: infraestructura propia de la
 * plataforma (`www`, `api`, `admin`...), servicios de correo que a veces
 * comparten el mismo dominio raíz (`mail`, `smtp`...) y hosts que la app
 * usa para sus propias pantallas (`login`, `auth`, `webhooks`...).
 *
 * Es un `ReadonlySet`, no un array: `slugDeHost`/`validarSlug` la consultan
 * con `.has()` en el camino caliente de cada request, y un Set no paga
 * O(n) por cada chequeo. `ReadonlySet` para que TypeScript avise si algún
 * llamador intenta mutarla — es una lista compartida entre todos los
 * productos.
 *
 * Una app puede pasar su propia lista (más larga) a `slugDeHost`/
 * `validarSlug`, pero esta es el piso: agregarle algo acá lo agrega para
 * TODOS los productos, así que solo van acá los nombres que son reservados
 * en cualquier deployment razonable.
 */
export const RESERVADOS: ReadonlySet<string> = new Set([
  "www",
  "app",
  "admin",
  "api",
  "portal",
  "plataforma",
  "static",
  "assets",
  "cdn",
  "mail",
  "smtp",
  "imap",
  "pop",
  "ftp",
  "ns",
  "ns1",
  "ns2",
  "dev",
  "staging",
  "test",
  "demo-app",
  "status",
  "help",
  "soporte",
  "ayuda",
  "blog",
  "docs",
  "login",
  "registro",
  "ingresar",
  "auth",
  "oauth",
  "cuenta",
  "panel",
  "webhook",
  "webhooks",
  "cron",
]);
