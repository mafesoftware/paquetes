/**
 * Lo específico de Drizzle: la tabla de auditoría, el trigger de
 * inmutabilidad, y las dos operaciones que la usan. Subpath separado
 * porque `drizzle-orm` es un peerDependency opcional — el núcleo
 * (`@mafesoftware/auditoria`) no lo necesita y no lo importa.
 *
 * Este paquete NO trae migraciones (spec 06 §3.2): cada app genera las
 * suyas con drizzle-kit a partir de su propio esquema, que usa
 * `tablaAuditoria`, y agrega el resultado de `sqlInmutabilidad` como una
 * migración escrita a mano aparte (ver su JSDoc). Ver `sql/ejemplo.sql`
 * para el DDL de referencia, con los dos incluidos.
 *
 * - `tabla.ts`: `tablaAuditoria`.
 * - `inmutabilidad.ts`: `sqlInmutabilidad` (trigger que bloquea
 *   UPDATE/DELETE/TRUNCATE).
 * - `auditar.ts`: `auditar` (nunca tira; SAVEPOINT si `dbOTx` ya es una
 *   transacción).
 * - `listar.ts`: `listarAuditoria`.
 * - `cliente.ts`: interno (el tipo `DbCliente`), no se re-exporta acá.
 * - `redactarCambios` (la redacción de `cambios` que usa `auditar`) vive
 *   en el núcleo (`@mafesoftware/auditoria`) desde la ronda 5: no necesita
 *   base de datos y es pública para el pipeline manual.
 *
 * Ejemplo completo:
 *
 * ```ts
 * import { tablaAuditoria, sqlInmutabilidad, auditar, listarAuditoria } from "@mafesoftware/auditoria/drizzle";
 *
 * export const auditoria = tablaAuditoria();
 *
 * // Migración a mano, después de la que generó drizzle-kit para "auditoria":
 * // correr sqlInmutabilidad("auditoria") contra la base.
 *
 * await auditar(db, auditoria, {
 *   tenantId, entidad: "producto", entidadId: id, accion: "actualizar",
 *   actor: { tipo: "usuario", id: usuarioId }, antes, despues,
 * });
 *
 * const { filas, total } = await listarAuditoria(db, auditoria, { tenantId, entidad: "producto", entidadId: id });
 * ```
 */
export { tablaAuditoria, type OpcionesTablaAuditoria, type ColumnasAuditoria, type TablaAuditoria, type ActorTipo } from "./tabla.js";
export { sqlInmutabilidad } from "./inmutabilidad.js";
export { auditar, type EntradaAuditoria, type ResultadoAuditar, type ErrorAuditoria } from "./auditar.js";
export { listarAuditoria, type OpcionesListarAuditoria, type FilaAuditoria, type ResultadoListarAuditoria } from "./listar.js";
export type { DbCliente } from "./cliente.js";
