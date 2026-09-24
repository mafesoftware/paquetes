import { sql } from "drizzle-orm";
import { ErrorOutbox } from "../errores.js";
import type { EstadoOutbox } from "../tipos.js";
import type { DbCliente } from "./cliente.js";
import { contarAfectadas } from "./contar-afectadas.js";
import type { TablaOutbox } from "./tabla.js";

/** Los únicos estados que `purgarOutbox` acepta borrar — los tres TERMINALES. Borrar `"pendiente"`/`"procesando"` sería borrar trabajo activo, nunca lo que este paquete debería hacer. */
const ESTADOS_PURGABLES: readonly EstadoOutbox[] = ["enviado", "descartado", "fallido"];

/** Opciones de `purgarOutbox`. */
export interface OpcionesPurgarOutbox {
  db: DbCliente;
  tabla: TablaOutbox;
  /** Qué estados borrar. Por defecto, los tres terminales (`"enviado" | "descartado" | "fallido"`). Cualquier otro valor (`"pendiente"`/`"procesando"`) tira `ErrorOutbox("opciones_invalidas")` — ver el JSDoc de la función. */
  estados?: readonly EstadoOutbox[];
  /** Borra solo filas cuyo `actualizado_en` sea ANTERIOR a este momento (estrictamente `<`) — nunca las tocadas después. */
  antesDe: Date;
}

/** Lo que devuelve `purgarOutbox`. */
export interface ResultadoPurgarOutbox {
  /** Cuántas filas se borraron. */
  eliminadas: number;
}

/**
 * Borra filas TERMINALES (por defecto `"enviado"`/`"descartado"`/
 * `"fallido"`) de la cola, para que no crezca sin límite — este paquete no
 * purga solo: hay que correrla vos (un cron aparte, o al final del que ya
 * corre `procesarOutbox`).
 *
 * **Nunca borra `"pendiente"` ni `"procesando"`** — pasar cualquiera de los
 * dos en `estados` tira `ErrorOutbox("opciones_invalidas")` ANTES de tocar
 * la base: purgar trabajo activo (agendado a futuro, o en vuelo) borraría
 * un mensaje real sin haberlo mandado nunca.
 *
 * **Filtra por `actualizado_en`, no por `creado_en`.** `actualizado_en` es
 * cuándo la fila llegó a su estado TERMINAL (la última escritura de
 * `procesarOutbox`) — `creado_en` es cuándo se ENCOLÓ, que para una fila
 * `"fallido"` tras varios reintentos con backoff puede ser bastante antes.
 * Filtrar por `creado_en` purgaría una fila que todavía podría estar
 * reintentando.
 *
 * ```ts
 * import { purgarOutbox } from "@mafesoftware/outbox/drizzle";
 *
 * // Borra lo terminado hace más de 30 días — un cron que corre una vez por día.
 * const { eliminadas } = await purgarOutbox({
 *   db,
 *   tabla: outbox,
 *   antesDe: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
 * });
 *
 * // Solo lo enviado con éxito (conserva descartado/fallido para diagnóstico):
 * await purgarOutbox({ db, tabla: outbox, estados: ["enviado"], antesDe: haceUnaSemana });
 * ```
 */
export async function purgarOutbox(opciones: OpcionesPurgarOutbox): Promise<ResultadoPurgarOutbox> {
  const estados = opciones.estados ?? ESTADOS_PURGABLES;
  if (!Array.isArray(estados) || estados.length === 0) {
    throw new ErrorOutbox("opciones_invalidas", 'purgarOutbox: "estados" no puede estar vacío.');
  }
  for (const estado of estados) {
    if (!ESTADOS_PURGABLES.includes(estado)) {
      throw new ErrorOutbox(
        "opciones_invalidas",
        `purgarOutbox: "${estado}" no es un estado purgable — solo ${ESTADOS_PURGABLES.map((e) => `"${e}"`).join(", ")} (nunca "pendiente"/"procesando": borraría trabajo activo).`,
      );
    }
  }
  if (!(opciones.antesDe instanceof Date) || Number.isNaN(opciones.antesDe.getTime())) {
    throw new ErrorOutbox("opciones_invalidas", 'purgarOutbox: "antesDe" tiene que ser una fecha válida.');
  }

  const colId = sql.identifier(opciones.tabla.id.name);
  const colEstado = sql.identifier(opciones.tabla.estado.name);
  const colActualizadoEn = sql.identifier(opciones.tabla.actualizadoEn.name);
  const listaEstados = sql.join(
    estados.map((estado) => sql`${estado}`),
    sql`, `,
  );

  // `RETURNING` (aunque no se use el valor) es lo que le da a
  // `contarAfectadas` un `rows` con el que contar si el driver no trae
  // `rowCount` — ver su JSDoc.
  const consulta = sql`
    delete from ${opciones.tabla}
    where ${colEstado} in (${listaEstados}) and ${colActualizadoEn} < ${opciones.antesDe}::timestamptz
    returning ${colId}
  `;

  const resultado = await opciones.db.execute(consulta);
  return { eliminadas: contarAfectadas(resultado) };
}
