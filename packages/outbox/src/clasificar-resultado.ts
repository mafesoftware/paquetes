/**
 * Lo que devuelve un intento de envío — la misma forma que `ResultadoCorreo`
 * de `@mafesoftware/correo` y `Resultado` de `@mafesoftware/kapso-wa`, pero
 * SIN importar ninguno de los dos paquetes (`categoria` es `string`, no la
 * unión literal de cada uno): así el núcleo no depende en tiempo de
 * ejecución NI de tipos de ningún paquete de transporte concreto, y mañana
 * puede sumarse un canal nuevo (SMS, push) sin tocar `clasificarResultado`.
 */
export type ResultadoTransporte =
  | { ok: true; idExterno?: string }
  | { ok: false; categoria: string; codigo?: string };

/**
 * En qué clase cae un `ResultadoTransporte`, para decidir qué hacer con la
 * fila de la cola:
 * - `"ok"`: se mandó. `procesarOutbox` marca la fila `"enviado"`.
 * - `"transitorio"`: puede andar en el próximo intento — `procesarOutbox`
 *   agenda un reintento con `backoff`, o pasa a `"fallido"` si ya agotó
 *   `maxIntentos`.
 * - `"permanente"`: reintentar da EXACTAMENTE el mismo resultado — un
 *   destinatario inválido no se vuelve válido esperando. `procesarOutbox`
 *   marca la fila `"descartado"` en el primer intento, sin gastar
 *   reintentos.
 */
export type ClaseResultado = "ok" | "transitorio" | "permanente";

/**
 * Categorías de `@mafesoftware/correo` (`red`, `limite`) y
 * `@mafesoftware/kapso-wa` (`red`, `limite`) que valen la pena reintentar:
 * un problema de RED o de LÍMITE de envíos (rate limit) del proveedor, no
 * del mensaje en sí — el mismo mensaje puede salir bien en el próximo
 * intento. `categoria` no reconocida (de un canal futuro, o un typo en un
 * `Transporte` casero) cae acá también — ver el JSDoc de
 * `clasificarResultado` para el porqué.
 */
export const CATEGORIAS_TRANSITORIAS: ReadonlySet<string> = new Set(["red", "limite"]);

/**
 * Categorías de `@mafesoftware/correo` (`credenciales`, `rechazado`) y
 * `@mafesoftware/kapso-wa` (`credenciales`, `rechazado`, `facturacion`,
 * `plantilla`, `numero`, `ventana`) que NUNCA se arreglan reintentando el
 * MISMO mensaje: una API key mala sigue mala, un destinatario inválido
 * sigue inválido, una plantilla no aprobada sigue sin aprobar. `ventana`
 * (la ventana de servicio de 24 h de WhatsApp) es permanente PARA EL
 * MENSAJE DE TEXTO LIBRE que la violó — la app tiene que mandar una
 * PLANTILLA en su lugar, no reintentar el mismo texto libre más tarde
 * (documentado también en el README).
 */
export const CATEGORIAS_PERMANENTES: ReadonlySet<string> = new Set([
  "credenciales",
  "rechazado",
  "facturacion",
  "plantilla",
  "numero",
  "ventana",
]);

/**
 * Clasifica un `ResultadoTransporte` en `"ok" | "transitorio" |
 * "permanente"` — la decisión que usa `procesarOutbox` para elegir entre
 * reintentar, descartar, o marcar enviado.
 *
 * **Una categoría desconocida (no listada en ninguno de los dos sets de
 * arriba) cae en `"transitorio"`, nunca en `"permanente"`.** Es la opción
 * SEGURA por default: tratar de más algo como permanente DESCARTA un
 * mensaje real sin haberlo intentado de verdad, mientras que tratar de más
 * algo como transitorio como mucho gasta reintentos de sobra antes de
 * llegar a `"fallido"` (nunca pierde el mensaje en silencio). Cubre además
 * cualquier error 5xx que un `Transporte` propio devuelva con una
 * `categoria` que no sea exactamente `"red"` (ej. `"servidor"`,
 * `"timeout"`) — sin necesidad de enumerar cada nombre posible.
 *
 * ```ts
 * import { clasificarResultado } from "@mafesoftware/outbox";
 *
 * clasificarResultado({ ok: true, idExterno: "msg_123" }); // "ok"
 * clasificarResultado({ ok: false, categoria: "red", codigo: "ECONNRESET" }); // "transitorio"
 * clasificarResultado({ ok: false, categoria: "limite" }); // "transitorio"
 * clasificarResultado({ ok: false, categoria: "credenciales" }); // "permanente"
 * clasificarResultado({ ok: false, categoria: "ventana" }); // "permanente": mandar una plantilla, no reintentar el texto libre
 * clasificarResultado({ ok: false, categoria: "algo-nuevo-sin-catalogar" }); // "transitorio" (default seguro)
 * ```
 */
export function clasificarResultado(resultado: ResultadoTransporte): ClaseResultado {
  if (resultado.ok) return "ok";
  if (CATEGORIAS_PERMANENTES.has(resultado.categoria)) return "permanente";
  return "transitorio";
}
