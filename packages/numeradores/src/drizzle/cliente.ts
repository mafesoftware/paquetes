import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * El tipo de `db`/`tx` que aceptan las funciones de este subpath: cualquier
 * `PgDatabase` de Drizzle — el `db` de nivel superior o, adentro de
 * `db.transaction(async (tx) => ...)`, la `tx` (que en tiempo de ejecución
 * es además una `PgTransaction`, ver `transaccion.ts`). Cubre node-postgres
 * y neon-serverless (los dos drivers que arman su `Database`/`Transaction`
 * heredando de las clases de `drizzle-orm/pg-core`), sin atarse al tipo
 * exacto de resultado de ninguno de los dos.
 */
export type DbCliente = PgDatabase<PgQueryResultHKT, any, any>;
