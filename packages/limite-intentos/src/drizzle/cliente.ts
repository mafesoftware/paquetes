import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * El tipo de `db`/`tx` que aceptan las funciones de este subpath: cualquier
 * `PgDatabase` de Drizzle — el `db` de nivel superior o, adentro de
 * `db.transaction(async (tx) => ...)`, la `tx`. Cubre node-postgres y
 * neon-serverless sin atarse al tipo exacto de resultado de ninguno de los
 * dos. Igual que `@mafesoftware/numeradores/drizzle` y
 * `@mafesoftware/outbox/drizzle`.
 *
 * A diferencia de esos dos paquetes, NINGUNA función de acá exige que sea
 * específicamente una `tx` (ver el JSDoc de `registrarIntento`): las tres
 * son sentencias atómicas de una sola ida a la base, así que se pueden
 * llamar con el `db` de nivel superior sin envolver nada.
 */
export type DbCliente = PgDatabase<PgQueryResultHKT, any, any>;
