import { foreignKey, type AnyPgColumn, type ForeignKeyBuilder, type UpdateDeleteAction } from "drizzle-orm/pg-core";

export interface OpcionesFkTenant<TTableName extends string, TForeignTableName extends string> {
  /** Las columnas de la tabla HIJA: su columna de tenant y la que apunta al padre (ej. `proyecto_id`). */
  columnas: {
    tenant: AnyPgColumn<{ tableName: TTableName }>;
    padreId: AnyPgColumn<{ tableName: TTableName }>;
  };
  /** Las columnas `(tenant, id)` de la tabla PADRE — las mismas que se le pasaron a `unicoConTenant` ahí. */
  columnasPadre: {
    tenant: AnyPgColumn<{ tableName: TForeignTableName }>;
    id: AnyPgColumn<{ tableName: TForeignTableName }>;
  };
  /** Nombre de la constraint en Postgres. Si no se pasa, drizzle genera uno a partir de los nombres de columna. */
  nombre?: string;
  onDelete?: UpdateDeleteAction;
  onUpdate?: UpdateDeleteAction;
}

/**
 * La FK compuesta `(tenant, padreId) → padre(tenant, id)` que hace que
 * Postgres RECHACE que una fila hija apunte al padre de otra organización
 * (spec 06 §3.1, regla 2) — sin esto, una FK simple sobre `padreId` deja
 * pasar perfecto una fila con `tenant = B` que referencia un padre de
 * `tenant = A`, porque Postgres solo mira que el `id` exista en algún lado,
 * no de quién es.
 *
 * La tabla padre necesita el índice único `unicoConTenant({ tenant, id })`
 * — Postgres exige que toda FK apunte a una clave (primary key o unique) de
 * la tabla referenciada, y `(tenant, id)` como PAR no es una por sí sola
 * aunque `id` ya sea primary key.
 *
 * Va en el `extraConfig` de la tabla hija:
 *
 * ```ts
 * import { pgTable, uuid, text } from "drizzle-orm/pg-core";
 * import { columnaTenant, fkTenant } from "@mafesoftware/tenant/drizzle";
 * import { proyectos } from "./proyectos.js";
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
 *       onDelete: "cascade",
 *     }),
 *   ],
 * );
 * ```
 *
 * Con esto, `insert into unidades (organizacion_id, proyecto_id, ...)
 * values ('org-B', '<id de un proyecto de org-A>', ...)` falla con
 * `foreign_key_violation` (código `23503`) en vez de guardar silenciosamente
 * una unidad que cruza organizaciones.
 */
export function fkTenant<TTableName extends string, TForeignTableName extends string>(
  opciones: OpcionesFkTenant<TTableName, TForeignTableName>,
): ForeignKeyBuilder {
  return foreignKey({
    name: opciones.nombre,
    columns: [opciones.columnas.tenant, opciones.columnas.padreId],
    foreignColumns: [opciones.columnasPadre.tenant, opciones.columnasPadre.id],
  })
    .onDelete(opciones.onDelete ?? "no action")
    .onUpdate(opciones.onUpdate ?? "no action");
}
