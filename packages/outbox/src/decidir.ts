import type { EstadoOutbox } from "./tipos.js";

/**
 * Lo que `decidir` necesita de una fila de la cola — un subconjunto de las
 * columnas de `tablaOutbox` (`@mafesoftware/outbox/drizzle`), en camelCase,
 * sin nada específico de Drizzle: así el núcleo se puede testear (y usar,
 * por ejemplo en un panel de admin) sin tocar Postgres.
 */
export interface MensajeParaDecidir {
  estado: EstadoOutbox;
  /** Cuántas veces ya se intentó enviar (incluye intentos fallidos y el que esté en curso). */
  intentos: number;
  /** Tope de intentos antes de pasar a `"fallido"`. */
  maxIntentos: number;
  /** No se envía antes de este momento (por defecto, el momento en que se encoló). */
  programadoPara: Date;
  /** Cuándo corresponde el PRÓXIMO intento, tras un fallo transitorio — `null` si todavía no hubo ninguno. */
  proximoIntentoEn: Date | null;
  /** Vencimiento del lease de un worker que la tiene en `"procesando"` — `null` si no está `"procesando"`. */
  bloqueadoHasta: Date | null;
}

/**
 * Qué corresponde hacer con una fila de la cola, en `ahora`:
 * - `"enviar"`: está `"pendiente"`, ya llegó su `programadoPara` y no está
 *   esperando un backoff — lista para reclamar y mandar.
 * - `"reintentar_luego"`: está `"pendiente"` pero ya falló una vez y está
 *   esperando su backoff (`proximoIntentoEn` todavía no llegó) — informativo,
 *   no hay nada que hacer hasta entonces.
 * - `"esperar"`: está `"pendiente"`, nunca se intentó todavía, y
 *   `programadoPara` es futuro (un envío agendado) — o está `"procesando"`
 *   con el lease todavía vigente (otro worker la tiene ahora mismo).
 * - `"destrabar"`: está `"procesando"` pero el lease VENCIÓ — el worker que
 *   la reclamó se cayó a mitad de camino (o tardó más que `leaseMs`); hay
 *   que reclamarla de nuevo.
 * - `"descartar"`: terminal — ya está `"enviado"`, `"fallido"` o
 *   `"descartado"`, o (salvaguarda) quedó `"pendiente"` con
 *   `intentos >= maxIntentos` sin que nadie la haya cerrado — no debería
 *   pasar en el flujo normal (`procesarOutbox` cierra una fila a
 *   `"fallido"` en el mismo intento en que agota `maxIntentos`), pero si
 *   pasara (una fila tocada a mano, una migración de datos), no hay que
 *   reintentarla nunca más.
 */
export type Decision = "enviar" | "reintentar_luego" | "descartar" | "destrabar" | "esperar";

const ESTADOS_TERMINALES = new Set<EstadoOutbox>(["enviado", "fallido", "descartado"]);

/**
 * Qué corresponde hacer con `mensaje` en `ahora` — la misma regla, en JS
 * puro y testeable sin Postgres, que implementa en SQL la consulta de
 * reclamo de `procesarOutbox` (`@mafesoftware/outbox/drizzle`): un `SELECT
 * ... FOR UPDATE SKIP LOCKED` reclama exactamente las filas para las que
 * `decidir` da `"enviar"` o `"destrabar"` (las dos terminan en el mismo
 * `UPDATE ... SET estado = 'procesando'` — `decidir` las distingue porque
 * significan cosas distintas para quien mira la cola: un envío que arranca
 * por primera vez contra uno que se está reclamando de un worker caído).
 * Las dos funciones tienen que dar la MISMA respuesta para los mismos datos
 * — si alguna vez cambia una, cambiar la otra.
 *
 * Nunca tira: cualquier combinación de campos (incluso una que no debería
 * poder ocurrir, como `"pendiente"` con `intentos >= maxIntentos`) da una
 * de las cinco decisiones, nunca una excepción.
 *
 * ```ts
 * import { decidir } from "@mafesoftware/outbox";
 *
 * const ahora = new Date("2026-09-24T12:00:00Z");
 *
 * decidir(
 *   { estado: "pendiente", intentos: 0, maxIntentos: 5, programadoPara: new Date("2026-09-24T11:00:00Z"), proximoIntentoEn: null, bloqueadoHasta: null },
 *   ahora,
 * ); // "enviar": ya llegó programadoPara, nunca se intentó
 *
 * decidir(
 *   { estado: "pendiente", intentos: 1, maxIntentos: 5, programadoPara: new Date("2026-09-24T11:00:00Z"), proximoIntentoEn: new Date("2026-09-24T12:30:00Z"), bloqueadoHasta: null },
 *   ahora,
 * ); // "reintentar_luego": ya falló una vez, esperando el backoff
 *
 * decidir(
 *   { estado: "procesando", intentos: 1, maxIntentos: 5, programadoPara: ahora, proximoIntentoEn: null, bloqueadoHasta: new Date("2026-09-24T11:45:00Z") },
 *   ahora,
 * ); // "destrabar": el lease venció (bloqueadoHasta < ahora), el worker que la tenía se cayó
 *
 * decidir(
 *   { estado: "enviado", intentos: 1, maxIntentos: 5, programadoPara: ahora, proximoIntentoEn: null, bloqueadoHasta: null },
 *   ahora,
 * ); // "descartar": terminal, ya se mandó
 * ```
 */
export function decidir(mensaje: MensajeParaDecidir, ahora: Date): Decision {
  if (ESTADOS_TERMINALES.has(mensaje.estado)) return "descartar";

  if (mensaje.estado === "procesando") {
    const leaseVencido = mensaje.bloqueadoHasta !== null && mensaje.bloqueadoHasta.getTime() <= ahora.getTime();
    return leaseVencido ? "destrabar" : "esperar";
  }

  // "pendiente": la única rama que queda (EstadoOutbox no tiene más valores).
  if (mensaje.intentos >= mensaje.maxIntentos) return "descartar"; // salvaguarda, ver el JSDoc del tipo `Decision`

  const yaLlegoElTurno = mensaje.programadoPara.getTime() <= ahora.getTime();
  if (!yaLlegoElTurno) return "esperar";

  const esperandoBackoff = mensaje.proximoIntentoEn !== null && mensaje.proximoIntentoEn.getTime() > ahora.getTime();
  return esperandoBackoff ? "reintentar_luego" : "enviar";
}
