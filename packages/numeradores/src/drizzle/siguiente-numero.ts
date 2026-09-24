import { sql } from "drizzle-orm";
import { formatearNumero } from "../formatear.js";
import type { DbCliente } from "./cliente.js";
import type { TablaNumeradores } from "./tabla.js";
import { exigirTransaccion } from "./transaccion.js";

/** Opciones de `siguienteNumero`. */
export interface OpcionesSiguienteNumero {
  tenantId: string;
  /** `null`/`undefined` = sin ámbito: una sola serie para todo el tenant (ver el JSDoc de `tablaNumeradores` sobre por qué es `""` en la fila, no `NULL`). */
  ambito?: string | null;
  tipo: string;
}

export interface ResultadoSiguienteNumero {
  numero: bigint;
  formateado: string;
}

/** Lo que devuelve la fila de la consulta atómica: `numero` es `bigint` pero el driver lo entrega como `string` (evita perder precisión más allá de `Number.MAX_SAFE_INTEGER`). */
interface FilaSiguienteNumero {
  numero: string;
  prefijo: string;
  relleno: number;
}

/**
 * El próximo número correlativo para `(tenantId, ambito, tipo)`: lo
 * entrega, deja la fila lista para el siguiente, y devuelve también el
 * texto ya formateado (`formatearNumero` con el `prefijo`/`relleno` de la
 * fila).
 *
 * **Exige transacción** (ver `exigirTransaccion`): tira
 * `ErrorNumeradores("requiere_transaccion")` si `tx` no es la que entrega
 * `db.transaction(async (tx) => ...)`. El número se considera consumido
 * recién cuando esa transacción confirma — si se llama fuera de una, un
 * rollback más adelante en el mismo flujo (por ejemplo, porque falló
 * insertar el comprobante) dejaría el número gastado sin nada que lo use.
 *
 * **Atómico bajo concurrencia**, con un único `INSERT ... ON CONFLICT
 * (tenant, ambito, tipo) DO UPDATE SET proximo = proximo + 1 RETURNING
 * proximo - 1`:
 *
 * - Si la fila NO existe, el `INSERT` la crea con `proximo = 2` (el
 *   próximo a entregar DESPUÉS de este) y el `RETURNING` da `2 - 1 = 1`:
 *   la primera vez que se pide un número para una combinación nueva,
 *   siempre es `1`.
 * - Si la fila YA existe (con `proximo = N`, el conflicto la actualiza a
 *   `N + 1` y el `RETURNING` da el valor YA actualizado menos uno, es
 *   decir `N`: el número que corresponde entregar ahora, dejando `N + 1`
 *   listo para el que sigue.
 *
 * Se prefirió esta forma sobre un `SELECT ... FOR UPDATE` + `UPDATE` porque
 * da las MISMAS garantías (la fila queda bloqueada para cualquier otra
 * transacción concurrente desde el momento del `INSERT`/`UPDATE` hasta que
 * esta transacción termina, así que dos transacciones que piden a la vez
 * literalmente se serializan una detrás de la otra en esa fila) en una sola
 * ida a la base en vez de dos, y sin la ventana entre el `SELECT` y el
 * `UPDATE` en la que un `SELECT ... FOR UPDATE` mal armado (sin `FOR
 * UPDATE`, por ejemplo) dejaría pasar una lectura sucia.
 *
 * ```ts
 * import { siguienteNumero } from "@mafesoftware/numeradores/drizzle";
 *
 * const { numero, formateado } = await db.transaction((tx) =>
 *   siguienteNumero(tx, numeradores, { tenantId, tipo: "recibo" }),
 * );
 * // numero: 1n, 2n, 3n, ... (bigint); formateado: "0001", "0002", ... según prefijo/relleno configurados
 * ```
 */
export async function siguienteNumero(
  tx: DbCliente,
  tabla: TablaNumeradores,
  opciones: OpcionesSiguienteNumero,
): Promise<ResultadoSiguienteNumero> {
  exigirTransaccion(tx);

  const ambito = opciones.ambito ?? "";
  // `${tabla}.${colProximo}` en el SET, no `${colProximo}` a secas: dentro
  // de un `ON CONFLICT DO UPDATE`, Postgres tiene EN SIMULTÁNEO en alcance
  // la fila ya existente (la del target table) y la fila propuesta
  // (`excluded`) — un nombre de columna sin calificar que existe en las dos
  // (como `proximo`, que se lista en el INSERT y por eso también está en
  // `excluded`) es AMBIGUO ("column reference \"proximo\" is ambiguous",
  // 42702) aunque acá nunca se use `excluded` explícitamente: alcanza con
  // que exista para que haga falta calificar cuál de las dos filas se
  // quiere leer.
  const colTenant = sql.identifier(tabla.tenantId.name);
  const colAmbito = sql.identifier(tabla.ambito.name);
  const colTipo = sql.identifier(tabla.tipo.name);
  const colProximo = sql.identifier(tabla.proximo.name);
  const colPrefijo = sql.identifier(tabla.prefijo.name);
  const colRelleno = sql.identifier(tabla.relleno.name);
  const colActualizadoEn = sql.identifier(tabla.actualizadoEn.name);

  const consulta = sql`
    insert into ${tabla} (${colTenant}, ${colAmbito}, ${colTipo}, ${colProximo})
    values (${opciones.tenantId}, ${ambito}, ${opciones.tipo}, 2)
    on conflict (${colTenant}, ${colAmbito}, ${colTipo})
    do update set ${colProximo} = ${tabla}.${colProximo} + 1, ${colActualizadoEn} = now()
    returning (${colProximo} - 1) as numero, ${colPrefijo} as prefijo, ${colRelleno} as relleno
  `;

  const resultado = (await tx.execute(consulta)) as unknown as { rows: FilaSiguienteNumero[] };
  const fila = resultado.rows[0];
  if (!fila) {
    // No debería pasar nunca: el INSERT ... ON CONFLICT DO UPDATE siempre
    // produce (e inserta o actualiza) exactamente una fila. Si llega acá es
    // un bug de esta función, no un caso de negocio a manejar.
    throw new Error("siguienteNumero: la consulta no devolvió ninguna fila (no debería pasar)");
  }

  const numero = BigInt(fila.numero);
  return { numero, formateado: formatearNumero(numero, { prefijo: fila.prefijo, relleno: fila.relleno }) };
}
