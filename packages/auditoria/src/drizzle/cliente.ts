import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * El tipo de `db`/`tx` que aceptan las funciones de este subpath: cualquier
 * `PgDatabase` de Drizzle — el `db` de nivel superior o, adentro de
 * `db.transaction(async (tx) => ...)`, la `tx` (que en tiempo de ejecución
 * es además una `PgTransaction`, que también extiende `PgDatabase`). Cubre
 * node-postgres y neon-serverless sin atarse al tipo exacto de resultado de
 * ninguno de los dos. Igual que `@mafesoftware/numeradores/drizzle`.
 */
export type DbCliente = PgDatabase<PgQueryResultHKT, any, any>;
