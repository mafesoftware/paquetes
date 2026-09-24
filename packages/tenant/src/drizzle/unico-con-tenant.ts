import { unique, type AnyPgColumn, type UniqueConstraintBuilder } from "drizzle-orm/pg-core";

/** Las dos columnas que identifican una fila para una FK compuesta de tenant: el tenant y el id propio. */
export interface ColumnasTenant {
  tenant: AnyPgColumn;
  id: AnyPgColumn;
}

/**
 * El índice único `(tenant, id)` que necesita toda tabla PADRE para que sus
 * hijas puedan referenciarla con `fkTenant`.
 *
 * Postgres exige que una FK apunte a una **clave** (primary key o unique)
 * de la tabla referenciada: como `id` solo ya es único (primary key), pero
 * la FK compuesta de `fkTenant` referencia `(tenant, id)` como PAR, hace
 * falta este unique adicional sobre las dos columnas juntas — sin él,
 * `fkTenant` falla al crear la tabla hija con
 * `there is no unique constraint matching given keys for referenced table`.
 *
 * Va en el `extraConfig` (tercer argumento) de `pgTable`, junto al resto de
 * la configuración extra de la tabla:
 *
 * ```ts
 * import { pgTable, uuid, text } from "drizzle-orm/pg-core";
 * import { columnaTenant, unicoConTenant } from "@mafesoftware/tenant/drizzle";
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
 * ```
 */
export function unicoConTenant(t: ColumnasTenant): UniqueConstraintBuilder {
  return unique().on(t.tenant, t.id);
}
