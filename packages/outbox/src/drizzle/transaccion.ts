import { is } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { ErrorOutbox } from "../errores.js";
import type { DbCliente } from "./cliente.js";

/**
 * Exige que `db` sea la `tx` que entrega `db.transaction(async (tx) => ...)`,
 * no el `db` de nivel superior. Tira `ErrorOutbox("requiere_transaccion")`
 * si no lo es.
 *
 * `encolar` la usa porque el mensaje solo debe considerarse "encolado" si
 * la transacción del HECHO DE NEGOCIO que lo dispara (crear el pedido,
 * confirmar el pago) termina confirmando: si se llamara con `db` a secas,
 * un error DESPUÉS de encolar (al guardar el resto de la operación) dejaría
 * un aviso de algo que nunca pasó en la cola de todos modos.
 *
 * **Detección:** `is(db, PgTransaction)`, no `db instanceof PgTransaction` —
 * mismo motivo que `@mafesoftware/numeradores/drizzle` (ver su JSDoc en
 * detalle): `is()` compara por `entityKind`, robusto ante dos copias de
 * `drizzle-orm` en `node_modules` (hoisting parcial de un monorepo, o una
 * app que trae su propio `drizzle-orm` además del que arrastra este
 * paquete como peerDependency) — ahí `instanceof` da `false` en silencio
 * para un objeto que SÍ es una `PgTransaction`.
 *
 * **Lo que ninguna detección en tiempo de ejecución atrapa:** una `tx`
 * guardada en una variable y usada DESPUÉS de que termine el callback de
 * `db.transaction(...)` que la entregó (ya confirmado o revertido) — sigue
 * pasando esta validación (en tiempo de ejecución sigue siendo una
 * instancia de `PgTransaction`), pero la conexión física que representaba
 * ya volvió al pool. Nunca guardes ni reuses una `tx` fuera del callback
 * que la recibió.
 */
export function exigirTransaccion(db: DbCliente): void {
  if (is(db, PgTransaction)) return;
  throw new ErrorOutbox(
    "requiere_transaccion",
    'encolar requiere una transacción: llamalo con la "tx" que entrega db.transaction(async (tx) => ...), no con "db" directo. El mensaje solo se debe encolar si la transacción del hecho de negocio que lo dispara confirma.',
  );
}
