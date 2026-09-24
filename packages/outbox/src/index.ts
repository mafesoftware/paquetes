/**
 * Outbox transaccional para correo y WhatsApp: la app encola un mensaje en
 * la MISMA transacción que el hecho de negocio que lo dispara (un pedido
 * creado, una cuota vencida) y un cron aparte lo procesa con reintentos,
 * backoff con jitter y `FOR UPDATE SKIP LOCKED` — nunca se manda el correo
 * o el WhatsApp DENTRO de la transacción de negocio (un proveedor caído no
 * puede colgar ni abortar la operación real), y nunca se pierde un aviso
 * porque el proceso se cayó justo después de confirmar la fila principal.
 *
 * **Entrega AL MENOS UNA VEZ, no exactamente una vez** — ver "Entrega al
 * menos una vez" en el JSDoc de `procesarOutbox`
 * (`@mafesoftware/outbox/drizzle`). `MensajeParaEnviar.claveIdempotencia`
 * (`${tenantId}:${claveIdempotencia}` de la fila) existe para que el
 * PROVEEDOR pueda deduplicar un reintento — `transporteCorreo` la pasa como
 * header `Idempotency-Key` de Resend.
 *
 * Núcleo puro: sin variables de entorno, sin framework, sin base de datos.
 * - `decidir.ts`: `decidir` — qué corresponde hacer con una fila de la cola
 *   ahora mismo (enviar, esperar, reintentar más tarde, destrabar, o
 *   descartar) — la misma regla que implementa en SQL la consulta de
 *   reclamo de `procesarOutbox`.
 * - `backoff.ts`: `backoff` — cuánto esperar antes del próximo intento,
 *   creciente con jitter, configurable, con `aleatorio` inyectable.
 * - `clasificar-resultado.ts`: `clasificarResultado` — mapea el resultado
 *   categorizado de un `Transporte` (mismas categorías que
 *   `@mafesoftware/correo`/`@mafesoftware/kapso-wa`) a `"ok" |
 *   "transitorio" | "permanente"`.
 * - `transporte.ts`: el tipo `Transporte` — la función que un canal usa
 *   para mandar de verdad, inyectada en `procesarOutbox`.
 * - `transportes/`: `transporteCorreo`/`transporteWhatsApp` — adaptan
 *   `@mafesoftware/correo`/`@mafesoftware/kapso-wa` a `Transporte`, SIN
 *   depender de ninguno de los dos paquetes en tiempo de ejecución (la
 *   función real que manda se inyecta — ver sus JSDoc).
 * - `errores.ts`: `ErrorOutbox`, el único error que tira este paquete.
 *
 * Lo específico de Drizzle (la tabla, `encolar`, `procesarOutbox`) vive en
 * el subpath `@mafesoftware/outbox/drizzle`, que NO se importa desde acá
 * (`drizzle-orm` es un peerDependency opcional solo de ese subpath).
 */
export { decidir, type Decision, type MensajeParaDecidir } from "./decidir.js";
export { backoff, type OpcionesBackoff } from "./backoff.js";
export {
  clasificarResultado,
  CATEGORIAS_PERMANENTES,
  CATEGORIAS_TRANSITORIAS,
  type ClaseResultado,
  type ResultadoTransporte,
} from "./clasificar-resultado.js";
export type { ContextoTransporte, MensajeParaEnviar, Transporte } from "./transporte.js";
export type { CanalOutbox, EstadoOutbox } from "./tipos.js";
export { ErrorOutbox, type CodigoErrorOutbox } from "./errores.js";
export {
  transporteCorreo,
  type CorreoRenderizado,
  type OpcionesTransporteCorreo,
  type ResultadoEnvioCorreo,
} from "./transportes/transporte-correo.js";
export {
  transporteWhatsApp,
  type OpcionesTransporteWhatsApp,
  type ResultadoEnvioWhatsApp,
} from "./transportes/transporte-whatsapp.js";
