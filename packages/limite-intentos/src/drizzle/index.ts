/**
 * Lo específico de Drizzle: la tabla del freno y las tres operaciones que la
 * usan. Subpath separado porque `drizzle-orm` es un peerDependency opcional
 * — el núcleo (`@mafesoftware/limite-intentos`) no lo necesita y no lo
 * importa.
 *
 * Este paquete NO trae migraciones (spec 06 §3.2): cada app genera las
 * suyas con drizzle-kit a partir de su propio esquema, que usa
 * `tablaIntentos`. Ver `sql/ejemplo.sql` para el DDL equivalente, de
 * referencia para consumidores sin Drizzle.
 *
 * - `tabla.ts`: `tablaIntentos`.
 * - `registrar-intento.ts`: `registrarIntento` — `INSERT ... ON CONFLICT DO
 *   UPDATE` atómico, ventana con auto-reinicio, bloqueo renovable. NO exige
 *   transacción.
 * - `consultar-intento.ts`: `consultarIntento` — lectura pura, para chequear
 *   antes de intentar autenticar.
 * - `limpiar-intentos.ts`: `limpiarIntentos` — borra la fila al loguear bien.
 * - `cliente.ts`: interno (el tipo `DbCliente` sí se re-exporta acá, ver
 *   abajo).
 * - `ErrorLimiteIntentos` (el mismo que exporta el núcleo,
 *   `@mafesoftware/limite-intentos`) se re-exporta también acá, para quien
 *   solo importa este subpath y necesita `instanceof ErrorLimiteIntentos`
 *   sin agregar un segundo import.
 *
 * ```ts
 * import { tablaIntentos, registrarIntento, consultarIntento, limpiarIntentos } from "@mafesoftware/limite-intentos/drizzle";
 * import { claveCuenta, claveIp } from "@mafesoftware/limite-intentos";
 *
 * export const limiteIntentos = tablaIntentos();
 *
 * // Antes de comparar la contraseña, chequear si ya está bloqueada:
 * const previo = await consultarIntento(db, limiteIntentos, { clave: claveCuenta(email) });
 * if (previo.bloqueado) throw new Error("demasiados intentos");
 *
 * // Login fallido: registrar el intento por cuenta Y por IP.
 * const cuenta = await registrarIntento(db, limiteIntentos, {
 *   clave: claveCuenta(email), maximo: 10, ventanaMs: 15 * 60_000, bloqueoMs: 15 * 60_000,
 * });
 * await registrarIntento(db, limiteIntentos, {
 *   clave: claveIp(ip), maximo: 20, ventanaMs: 15 * 60_000, bloqueoMs: 15 * 60_000,
 * });
 *
 * // Login correcto: limpiar el contador de la cuenta.
 * await limpiarIntentos(db, limiteIntentos, claveCuenta(email));
 * ```
 */
export { tablaIntentos, type ColumnasIntentos, type OpcionesTablaIntentos, type TablaIntentos } from "./tabla.js";
export { registrarIntento, type OpcionesRegistrarIntento, type ResultadoRegistrarIntento } from "./registrar-intento.js";
export { consultarIntento, type OpcionesConsultarIntento, type ResultadoConsultarIntento } from "./consultar-intento.js";
export { limpiarIntentos } from "./limpiar-intentos.js";
export { ErrorLimiteIntentos, type CodigoErrorLimiteIntentos } from "../errores.js";
export type { DbCliente } from "./cliente.js";
