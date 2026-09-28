import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * El tipo de `db`/`tx` que aceptan las funciones de este subpath: cualquier
 * `PgDatabase` de Drizzle (el `db` de nivel superior, o la `tx` adentro de
 * `db.transaction(async (tx) => ...)`). Mismo tipo que usan
 * `@mafesoftware/numeradores/drizzle` y `@mafesoftware/outbox/drizzle`.
 */
export type DbCliente = PgDatabase<PgQueryResultHKT, any, any>;
