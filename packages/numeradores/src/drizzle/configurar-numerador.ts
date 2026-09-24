import { sql } from "drizzle-orm";
import { ErrorNumeradores } from "../errores.js";
import type { DbCliente } from "./cliente.js";
import type { TablaNumeradores } from "./tabla.js";

/** Opciones de `configurarNumerador`. Los tres últimos campos reemplazan la configuración completa (no un merge parcial) — mismo default que la columna si no se pasan. */
export interface OpcionesConfigurarNumerador {
  tenantId: string;
  /** `null`/`undefined` = sin ámbito (ver el JSDoc de `tablaNumeradores`). */
  ambito?: string | null;
  tipo: string;
  /** `""` por defecto. */
  prefijo?: string;
  /** `0` por defecto. */
  relleno?: number;
  /** `1n` por defecto: el próximo número a entregar. */
  proximo?: bigint;
}

/**
 * Crea o reconfigura el numerador de `(tenantId, ambito, tipo)`: `prefijo`,
 * `relleno` y, sobre todo, `proximo` — pensado para dar de alta un talonario
 * nuevo, o para "avanzar" uno existente cuando hay que migrar números que ya
 * se emitieron fuera del sistema (talonarios de papel, otro sistema).
 *
 * **Nunca baja `proximo`.** Hacerlo generaría números repetidos: si el
 * numerador ya entregó hasta `50` y alguien lo reconfigura a `proximo: 10`,
 * el siguiente `siguienteNumero` volvería a entregar `10`, que ya existe en
 * un comprobante real. Por eso, si `proximo` (con su default `1n` cuando no
 * se pasa) es MENOR al valor actual de la fila, tira
 * `ErrorNumeradores("retroceso_no_permitido")` y no cambia nada — ni
 * siquiera `prefijo`/`relleno`, para que la llamada sea todo-o-nada.
 *
 * El chequeo es atómico (un único `INSERT ... ON CONFLICT ... DO UPDATE ...
 * WHERE <proximo actual> <= <proximo nuevo>`), no un `SELECT` seguido de un
 * `UPDATE` condicional en el código de la app: entre esas dos sentencias
 * podría meterse un `siguienteNumero` concurrente que avanza `proximo`, y el
 * `UPDATE` de la app pisaría ese avance sin que nadie se entere.
 *
 * ```ts
 * import { configurarNumerador, ErrorNumeradores } from "@mafesoftware/numeradores/drizzle";
 *
 * // Alta de un talonario nuevo, con prefijo y relleno.
 * await db.transaction((tx) =>
 *   configurarNumerador(tx, numeradores, { tenantId, tipo: "recibo", prefijo: "R-", relleno: 4 }),
 * );
 *
 * // Migrar un talonario que en papel ya llegó al 500: el próximo que entregue el sistema es 501.
 * await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", proximo: 501n });
 *
 * // Intentar bajarlo (ya entregó hasta 501, alguien pide volver a 10):
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
  const ambito = opciones.ambito ?? "";
  const prefijo = opciones.prefijo ?? "";
  const relleno = opciones.relleno ?? 0;
  const proximo = opciones.proximo ?? 1n;

  const colTenant = sql.identifier(tabla.tenantId.name);
  const colAmbito = sql.identifier(tabla.ambito.name);
  const colTipo = sql.identifier(tabla.tipo.name);
  const colProximo = sql.identifier(tabla.proximo.name);
  const colPrefijo = sql.identifier(tabla.prefijo.name);
  const colRelleno = sql.identifier(tabla.relleno.name);
  const colActualizadoEn = sql.identifier(tabla.actualizadoEn.name);

  // Igual que en siguienteNumero: dentro de ON CONFLICT DO UPDATE, un
  // nombre de columna sin calificar es ambiguo entre la fila existente
  // (target table) y la propuesta (`excluded`) para toda columna que
  // aparezca en el INSERT — así que la fila existente se referencia como
  // `${tabla}.${colProximo}`, nunca a secas.
  const consulta = sql`
    insert into ${tabla} (${colTenant}, ${colAmbito}, ${colTipo}, ${colPrefijo}, ${colRelleno}, ${colProximo})
    values (${opciones.tenantId}, ${ambito}, ${opciones.tipo}, ${prefijo}, ${relleno}, ${proximo})
    on conflict (${colTenant}, ${colAmbito}, ${colTipo})
    do update set ${colPrefijo} = excluded.${colPrefijo}, ${colRelleno} = excluded.${colRelleno}, ${colProximo} = excluded.${colProximo}, ${colActualizadoEn} = now()
    where ${tabla}.${colProximo} <= excluded.${colProximo}
    returning ${colProximo} as proximo
  `;

  const resultado = (await tx.execute(consulta)) as unknown as { rows: unknown[] };
  if (resultado.rows.length === 0) {
    // La única forma de que este INSERT ... ON CONFLICT no devuelva
    // ninguna fila es que la fila YA existía (si no, el INSERT sin
    // conflicto siempre inserta y devuelve) y el WHERE de la guarda la
    // descartó: el `proximo` pedido es menor al que ya tenía la fila.
    throw new ErrorNumeradores(
      "retroceso_no_permitido",
      `configurarNumerador: no se puede bajar "proximo" a ${proximo} para tenantId=${opciones.tenantId}, ambito=${JSON.stringify(ambito)}, tipo=${opciones.tipo} — ya está en un valor mayor.`,
    );
  }
}
