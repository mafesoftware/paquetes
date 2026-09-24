/**
 * Lo específico de Drizzle: la FK compuesta que hace que Postgres RECHACE
 * una fila hija que apunta al padre de otra organización (spec 06 §3.1,
 * regla 2). Subpath separado porque `drizzle-orm` es un peerDependency
 * opcional — el núcleo (`@mafesoftware/tenant`) no lo necesita y no lo
 * importa.
 *
 * Este paquete NO trae migraciones (spec 06 §3.2): cada app genera las
 * suyas con drizzle-kit a partir de su propio esquema, que usa estas tres
 * funciones. Ver `sql/ejemplo.sql` para el DDL equivalente, de referencia
 * para consumidores sin Drizzle.
 *
 * - `columna-tenant.ts`: `columnaTenant`.
 * - `unico-con-tenant.ts`: `unicoConTenant`.
 * - `fk-tenant.ts`: `fkTenant`.
 *
 * Ejemplo completo (padre `proyectos` + hija `unidades`):
 *
 * ```ts
 * import { pgTable, uuid, text } from "drizzle-orm/pg-core";
 * import { columnaTenant, unicoConTenant, fkTenant } from "@mafesoftware/tenant/drizzle";
 *
 * export const proyectos = pgTable(
 *   "proyectos",
 *   {
 *     id: uuid("id").primaryKey(),
 *     organizacionId: columnaTenant(),
 *     nombre: text("nombre").notNull(),
 *   },
 *   (t) => [unicoConTenant({ tenant: t.organizacionId, id: t.id })],
 * );
 *
 * export const unidades = pgTable(
 *   "unidades",
 *   {
 *     id: uuid("id").primaryKey(),
 *     organizacionId: columnaTenant(),
 *     proyectoId: uuid("proyecto_id").notNull(),
 *     nombre: text("nombre").notNull(),
 *   },
 *   (t) => [
 *     fkTenant({
 *       columnas: { tenant: t.organizacionId, padreId: t.proyectoId },
 *       columnasPadre: { tenant: proyectos.organizacionId, id: proyectos.id },
 *     }),
 *   ],
 * );
 * ```
 *
 * Con esto, `insert into unidades (organizacion_id, proyecto_id, ...) values
 * ('<org B>', '<id de un proyecto de org A>', ...)` falla con
 * `foreign_key_violation` (código `23503`).
 */
export { columnaTenant, type TipoColumnaTenant } from "./columna-tenant.js";
export { unicoConTenant, type ColumnasTenant } from "./unico-con-tenant.js";
export { fkTenant, type OpcionesFkTenant } from "./fk-tenant.js";
