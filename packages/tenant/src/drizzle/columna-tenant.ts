import { text, uuid } from "drizzle-orm/pg-core";

/** El tipo de columna que guarda el id de tenant: `uuid` (lo normal) o `text` (para ids externos/legacy). */
export type TipoColumnaTenant = "uuid" | "text";

/**
 * La columna de tenant de una tabla, lista para poner en el mapa de
 * columnas de `pgTable`. `NOT NULL` siempre — spec 06 §3.1 exige el id de
 * tenant en TODAS las tablas de negocio, incluidas las hijas, y una
 * columna de tenant nullable dejaría filas sin dueño que ningún filtro por
 * tenant encuentra (ni protege).
 *
 * El nombre y el tipo son parámetros (no una constante hardcodeada) porque
 * cada app nombra distinto su columna de tenant (`organizacion_id` acá,
 * `club_id`/`tenant_id` en otras) y algunas todavía tienen el id como
 * `text` en vez de `uuid` — ver spec 06 §3.2 ("fábricas de tablas
 * parametrizadas por la columna de tenant").
 *
 * ```ts
 * import { pgTable } from "drizzle-orm/pg-core";
 * import { columnaTenant } from "@mafesoftware/tenant/drizzle";
 *
 * export const proyectos = pgTable("proyectos", {
 *   organizacionId: columnaTenant(), // uuid "organizacion_id" not null
 *   id: uuid("id").primaryKey(),
 * });
 * ```
 */
export function columnaTenant(nombre = "organizacion_id", tipo: TipoColumnaTenant = "uuid") {
  return tipo === "uuid" ? uuid(nombre).notNull() : text(nombre).notNull();
}
