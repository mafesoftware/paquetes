/**
 * Cuántas filas afectó un `UPDATE`/`DELETE` — soporta las dos formas que
 * puede tener el resultado de `db.execute(...)` (`tx.execute`/`db.execute`
 * de Drizzle) según el driver de Postgres por debajo:
 *
 * - **node-postgres** (`drizzle-orm/node-postgres`): siempre trae
 *   `rowCount` (un `number`, `0` incluido si no afectó nada).
 * - **Otros drivers** (ej. ciertos modos/versiones de
 *   `drizzle-orm/neon-serverless` sobre HTTP): pueden NO traer `rowCount`
 *   — pero, si la consulta lleva `RETURNING` (como TODAS las de este
 *   paquete que necesitan contar filas afectadas — ver `registrarResultado`/
 *   `liberarFila` en `procesar.ts` y `purgarOutbox` en `purgar.ts`),
 *   siempre traen `rows`, con exactamente una fila por cada fila afectada.
 *
 * Sin este fallback, un driver sin `rowCount` haría que CUALQUIER
 * escritura pareciera "no afectó nada" — en `procesarOutbox`, eso
 * reportaría cada fila como `"perdidos"` (el fencing por lease, ver su
 * JSDoc) EN SILENCIO, aunque el `UPDATE` haya escrito de verdad: el peor
 * tipo de bug, porque no tira ni se nota salvo mirando el resumen con
 * atención.
 *
 * Nunca tira: si ni `rowCount` ni `rows` tienen una forma reconocible, da
 * `0` (el mismo comportamiento — conservador — que "no se pudo confirmar
 * que escribiera nada").
 */
export function contarAfectadas(resultado: unknown): number {
  if (resultado === null || typeof resultado !== "object") return 0;
  const { rowCount, rows } = resultado as { rowCount?: unknown; rows?: unknown };
  if (typeof rowCount === "number") return rowCount;
  if (Array.isArray(rows)) return rows.length;
  return 0;
}
