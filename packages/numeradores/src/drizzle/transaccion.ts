import { PgTransaction } from "drizzle-orm/pg-core";
import { ErrorNumeradores } from "../errores.js";
import type { DbCliente } from "./cliente.js";

/**
 * Exige que `db` sea la `tx` que entrega `db.transaction(async (tx) => ...)`,
 * no el `db` de nivel superior. Tira `ErrorNumeradores("requiere_transaccion")`
 * si no lo es.
 *
 * `siguienteNumero` la usa porque el número que entrega solo debe
 * considerarse "consumido" si la transacción que lo pidió termina
 * confirmando: si se llamara con `db` directo (sin transacción explícita),
 * cada sentencia corre en su propia transacción implícita de Postgres, así
 * que un error DESPUÉS de numerar (por ejemplo, al insertar el comprobante)
 * dejaría el número gastado sin ningún comprobante que lo use — un hueco.
 *
 * **Detección:** `db instanceof PgTransaction`, la clase abstracta de
 * `drizzle-orm/pg-core` de la que heredan tanto `NodePgTransaction`
 * (node-postgres) como `NeonTransaction` (neon-serverless) — no una
 * reimplementación por driver, la MISMA clase base. Es robusta porque
 * inspecciona el objeto que Drizzle arma de verdad para representar "estoy
 * dentro de una transacción", no una heurística contra la base:
 *
 * - `SELECT current_setting('transaction_isolation')` NO alcanza: devuelve
 *   un valor igual de "válido" para una sentencia suelta, porque toda
 *   sentencia en Postgres corre dentro de ALGUNA transacción (una implícita
 *   de una sola sentencia si no se abrió una a mano) — no distingue "estoy
 *   en una transacción propia de la app" de "estoy en la implícita de esta
 *   única consulta".
 * - `SELECT txid_current_if_assigned()` depende de qué conexión FÍSICA
 *   ejecuta esa consulta en ese momento — con un pool, no hay garantía de
 *   que sea la misma conexión que después corre el `INSERT` de
 *   `siguienteNumero`, así que una detección basada en eso podría aprobar
 *   una conexión y ejecutar la numeración en otra.
 *
 * El `instanceof` no tiene ese problema: mira el objeto de JavaScript que la
 * propia app va a usar para la consulta siguiente, no un estado de la base
 * que podría corresponder a otra conexión.
 */
export function exigirTransaccion(db: DbCliente): void {
  if (db instanceof PgTransaction) return;
  throw new ErrorNumeradores(
    "requiere_transaccion",
    'siguienteNumero requiere una transacción: llamalo con la "tx" que entrega db.transaction(async (tx) => ...), no con "db" directo. El número solo se debe consumir si la transacción que lo pide confirma.',
  );
}
