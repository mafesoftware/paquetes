/**
 * Lo específico de Drizzle: la tabla de la cola y las dos operaciones que la
 * usan. Subpath separado porque `drizzle-orm` es un peerDependency opcional
 * — el núcleo (`@mafesoftware/outbox`) no lo necesita y no lo importa.
 *
 * Este paquete NO trae migraciones (spec 06 §3.2): cada app genera las
 * suyas con drizzle-kit a partir de su propio esquema, que usa
 * `tablaOutbox`. Ver `sql/ejemplo.sql` para el DDL equivalente, de
 * referencia para consumidores sin Drizzle.
 *
 * - `tabla.ts`: `tablaOutbox`.
 * - `encolar.ts`: `encolar` (exige transacción, idempotente por
 *   `(tenant, claveIdempotencia)`).
 * - `procesar.ts`: `procesarOutbox` (reclama con `FOR UPDATE SKIP LOCKED`,
 *   llama a los `Transporte` de cada canal, registra el resultado).
 * - `cliente.ts` / `transaccion.ts`: internos (el tipo `DbCliente` y la
 *   detección de transacción), no se re-exportan acá.
 *
 * Ejemplo completo — ver también `transporteCorreo`/`transporteWhatsApp`
 * (`@mafesoftware/outbox`, el núcleo) para armar `transportes`:
 *
 * ```ts
 * import { tablaOutbox, encolar, procesarOutbox } from "@mafesoftware/outbox/drizzle";
 *
 * export const outbox = tablaOutbox();
 *
 * // Al crear el hecho de negocio, en la MISMA transacción:
 * await db.transaction(async (tx) => {
 *   await tx.insert(pedidos).values({ ... });
 *   await encolar(tx, outbox, {
 *     tenantId, canal: "correo", destino: cliente.email, plantilla: "confirmacion_pedido",
 *     datos: { pedidoId }, claveIdempotencia: `confirmacion-pedido-${pedidoId}`,
 *   });
 * });
 *
 * // En el cron, cada minuto:
 * const resumen = await procesarOutbox({ db, tabla: outbox, transportes: { correo, whatsapp } });
 * ```
 */
export { tablaOutbox, type ColumnasOutbox, type OpcionesTablaOutbox, type TablaOutbox } from "./tabla.js";
export { encolar, type OpcionesEncolar, type ResultadoEncolar } from "./encolar.js";
export { procesarOutbox, type OpcionesProcesarOutbox, type ResumenProcesarOutbox } from "./procesar.js";
export type { DbCliente } from "./cliente.js";
