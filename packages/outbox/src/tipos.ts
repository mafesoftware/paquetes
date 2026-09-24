/**
 * Los dos tipos compartidos por todo el paquete (núcleo y `/drizzle`):
 * por qué canal sale un mensaje, y en qué estado está una fila de la cola.
 * Viven acá, no repetidos en cada archivo, para que `decidir`,
 * `clasificarResultado`, `Transporte`, `tablaOutbox`, `encolar` y
 * `procesarOutbox` hablen exactamente del mismo vocabulario.
 */

/** Por dónde sale el mensaje. Cada canal tiene su propio `Transporte` en `procesarOutbox({ transportes: { correo, whatsapp } })`. */
export type CanalOutbox = "correo" | "whatsapp";

/**
 * En qué estado está una fila de la cola:
 * - `"pendiente"`: recién encolada, o esperando su próximo intento
 *   (`proximoIntentoEn`) tras un fallo transitorio. Candidata a `"enviar"`
 *   una vez que `programadoPara`/`proximoIntentoEn` ya pasaron.
 * - `"procesando"`: un worker la reclamó (`SELECT ... FOR UPDATE SKIP
 *   LOCKED`) y está (o estuvo) intentando enviarla; `bloqueadoHasta` es el
 *   vencimiento del lease — pasado ese momento sin resolverse (worker
 *   caído a mitad de camino), otro worker la reclama de nuevo
 *   (`"destrabar"`).
 * - `"enviado"`: terminal, ok. `idExterno` tiene el id que dio el proveedor.
 * - `"fallido"`: terminal, agotó `maxIntentos` con errores TRANSITORIOS
 *   (`red`/`limite`/...). Nunca se reintenta más.
 * - `"descartado"`: terminal, un error PERMANENTE (`credenciales`/
 *   `rechazado`/...) lo sacó de la cola sin gastar reintentos — reintentar
 *   un error permanente repite exactamente el mismo resultado.
 */
export type EstadoOutbox = "pendiente" | "procesando" | "enviado" | "fallido" | "descartado";
