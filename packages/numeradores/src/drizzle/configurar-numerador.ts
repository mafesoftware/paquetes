import { sql } from "drizzle-orm";
import { ErrorNumeradores } from "../errores.js";
import type { DbCliente } from "./cliente.js";
import type { TablaNumeradores } from "./tabla.js";

/**
 * Opciones de `configurarNumerador`. `prefijo`/`relleno`/`proximo` son un
 * MERGE parcial, no un reemplazo completo: el campo que no se pasa
 * conserva el valor que la fila ya tenía (o el default de la columna, si
 * la fila todavía no existe) — ver el JSDoc de `configurarNumerador`.
 */
export interface OpcionesConfigurarNumerador {
  tenantId: string;
  /** `null`/`undefined` = sin ámbito (ver el JSDoc de `tablaNumeradores`). */
  ambito?: string | null;
  tipo: string;
  /** Sin pasar: `""` si la fila es nueva, o el valor actual si ya existía. */
  prefijo?: string;
  /** Sin pasar: `0` si la fila es nueva, o el valor actual si ya existía. Debe ser un entero `>= 0`. */
  relleno?: number;
  /** Sin pasar: `1n` si la fila es nueva, o el valor actual si ya existía. Debe ser `>= 1n`, y nunca puede bajar del valor actual de la fila (ver más abajo). */
  proximo?: bigint;
}

/**
 * Crea o reconfigura el numerador de `(tenantId, ambito, tipo)`: `prefijo`,
 * `relleno` y, sobre todo, `proximo` — pensado para dar de alta un talonario
 * nuevo, o para "avanzar" uno existente cuando hay que migrar números que ya
 * se emitieron fuera del sistema (talonarios de papel, otro sistema).
 *
 * **Es un merge parcial, no un reemplazo completo.** El campo que NO se
 * pasa conserva lo que la fila ya tenía — si se pasara por alto esto,
 * `configurarNumerador(tx, tabla, { tenantId, tipo, proximo: 501n })`
 * (avanzar un talonario que ya tenía `prefijo: "R-"` configurado) borraría
 * silenciosamente el prefijo. Solo cuando la fila es NUEVA (no había
 * ninguna para ese `(tenantId, ambito, tipo)`) los campos omitidos toman el
 * default de la columna (`""` para `prefijo`, `0` para `relleno`, `1n`
 * para `proximo`). Es un único `INSERT ... ON CONFLICT DO UPDATE` con
 * `coalesce(<valor nuevo o null si se omitió>, <valor actual de la fila>)`
 * en cada campo — ver el cuerpo de la función.
 *
 * **Nunca baja `proximo`.** Hacerlo generaría números repetidos: si el
 * numerador ya entregó hasta `50` y alguien lo reconfigura a `proximo: 10`,
 * el siguiente `siguienteNumero` volvería a entregar `10`, que ya existe en
 * un comprobante real. Si `proximo` se pasa y es MENOR al valor actual de
 * la fila, tira `ErrorNumeradores("retroceso_no_permitido")` y no cambia
 * NADA — ni siquiera `prefijo`/`relleno`, para que la llamada sea
 * todo-o-nada. Pasar el MISMO valor que ya tiene (o no pasar `proximo`) no
 * es un retroceso: se acepta (idempotente).
 *
 * El chequeo es atómico (el `WHERE` del `DO UPDATE` compara contra la fila
 * actual dentro de la misma sentencia), no un `SELECT` seguido de un
 * `UPDATE` condicional en el código de la app: entre esas dos sentencias
 * podría meterse un `siguienteNumero` concurrente que avanza `proximo`, y
 * el `UPDATE` de la app pisaría ese avance sin que nadie se entere.
 *
 * **Valida antes de tocar la base** (sin ida y vuelta): `proximo` (si se
 * pasa) tiene que ser `>= 1n` (`ErrorNumeradores("proximo_invalido")`) —
 * no hay comprobante número `0` o negativo. `relleno` (si se pasa) tiene
 * que ser un entero `>= 0` (`ErrorNumeradores("relleno_invalido")`).
 *
 * ```ts
 * import { configurarNumerador, ErrorNumeradores } from "@mafesoftware/numeradores/drizzle";
 *
 * // Alta de un talonario nuevo, con prefijo y relleno.
 * await db.transaction((tx) =>
 *   configurarNumerador(tx, numeradores, { tenantId, tipo: "recibo", prefijo: "R-", relleno: 4 }),
 * );
 *
 * // Migrar ese MISMO talonario, que en papel ya llegó al 500: el próximo
 * // que entregue el sistema es 501. prefijo/relleno NO se pasan, así que
 * // conservan "R-"/4 — el siguiente número sale "R-0501", no "0501".
 * await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", proximo: 501n });
 *
 * // Reconfigurar SOLO el prefijo de un talonario ya en uso (proximo en
 * // 501, por ejemplo): no se toca, sigue en 501, nunca es un retroceso.
 * await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", prefijo: "REC-" });
 *
 * // Re-correr el mismo seed (mismos valores) es idempotente: no falla.
 * await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", proximo: 501n });
 *
 * // Intentar bajarlo (ya está en 501, alguien pide volver a 10):
 * try {
 *   await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", proximo: 10n });
 * } catch (error) {
 *   if (error instanceof ErrorNumeradores) error.codigo; // "retroceso_no_permitido"
 * }
 * ```
 */
export async function configurarNumerador(
  tx: DbCliente,
  tabla: TablaNumeradores,
  opciones: OpcionesConfigurarNumerador,
): Promise<void> {
  if (opciones.proximo !== undefined && opciones.proximo < 1n) {
    throw new ErrorNumeradores(
      "proximo_invalido",
      `configurarNumerador: "proximo" tiene que ser >= 1 (fue ${opciones.proximo}).`,
    );
  }
  if (opciones.relleno !== undefined && (!Number.isInteger(opciones.relleno) || opciones.relleno < 0)) {
    throw new ErrorNumeradores(
      "relleno_invalido",
      `configurarNumerador: "relleno" tiene que ser un entero >= 0 (fue ${opciones.relleno}).`,
    );
  }

  const ambito = opciones.ambito ?? "";
  // `null` cuando el campo NO se pasó: es el sentinel que `coalesce(...)`
  // usa más abajo para "no lo estoy tocando, dejá lo que la fila ya tenía"
  // — distinto de "lo estoy fijando a su valor por defecto" (`""`, `0`,
  // `1n`), que solo se aplica cuando la fila es nueva (ver el JSDoc).
  const prefijoParam: string | null = opciones.prefijo ?? null;
  const rellenoParam: number | null = opciones.relleno ?? null;
  const proximoParam: bigint | null = opciones.proximo ?? null;

  const colTenant = sql.identifier(tabla.tenantId.name);
  const colAmbito = sql.identifier(tabla.ambito.name);
  const colTipo = sql.identifier(tabla.tipo.name);
  const colProximo = sql.identifier(tabla.proximo.name);
  const colPrefijo = sql.identifier(tabla.prefijo.name);
  const colRelleno = sql.identifier(tabla.relleno.name);
  const colActualizadoEn = sql.identifier(tabla.actualizadoEn.name);

  // Los tres `coalesce(...)` de las VALUES son para la fila NUEVA (sin
  // conflicto): si el parámetro es null (campo omitido), cae al default de
  // la columna, escrito acá a mano (`''`, `0`, `1`) porque `coalesce`
  // necesita un segundo valor concreto — no puede "omitir la columna" a
  // mitad de una lista de VALUES. Los tres `coalesce(...)` del DO UPDATE
  // SET son para la fila EXISTENTE: si el parámetro es null, caen al valor
  // ACTUAL de la fila (`${tabla}.${colX}`, calificado — no se usa
  // `excluded` acá, así que no hay el problema de ambigüedad de columna
  // que sí tiene `siguienteNumero` (ver su comentario), pero calificar no
  // está de más).
  const consulta = sql`
    insert into ${tabla} (${colTenant}, ${colAmbito}, ${colTipo}, ${colPrefijo}, ${colRelleno}, ${colProximo})
    values (
      ${opciones.tenantId}, ${ambito}, ${opciones.tipo},
      coalesce(${prefijoParam}, ''), coalesce(${rellenoParam}, 0), coalesce(${proximoParam}, 1)
    )
    on conflict (${colTenant}, ${colAmbito}, ${colTipo})
    do update set
      ${colPrefijo} = coalesce(${prefijoParam}, ${tabla}.${colPrefijo}),
      ${colRelleno} = coalesce(${rellenoParam}, ${tabla}.${colRelleno}),
      ${colProximo} = coalesce(${proximoParam}, ${tabla}.${colProximo}),
      ${colActualizadoEn} = now()
    where ${tabla}.${colProximo} <= coalesce(${proximoParam}, ${tabla}.${colProximo})
    returning ${colProximo} as proximo
  `;

  const resultado = (await tx.execute(consulta)) as unknown as { rows: unknown[] };
  if (resultado.rows.length === 0) {
    // La única forma de que este INSERT ... ON CONFLICT no devuelva
    // ninguna fila es que la fila YA existía (si no, el INSERT sin
    // conflicto siempre inserta y devuelve) y el WHERE de la guarda la
    // descartó: `proximo` se pasó y es menor al que ya tenía la fila.
    throw new ErrorNumeradores(
      "retroceso_no_permitido",
      `configurarNumerador: no se puede bajar "proximo" a ${opciones.proximo} para tenantId=${opciones.tenantId}, ambito=${JSON.stringify(ambito)}, tipo=${opciones.tipo} — ya está en un valor mayor.`,
    );
  }
}
