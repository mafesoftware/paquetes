import { createHash } from "node:crypto";
import { getTableName } from "drizzle-orm";
import { foreignKey, type AnyPgColumn, type ForeignKeyBuilder, type UpdateDeleteAction } from "drizzle-orm/pg-core";

export interface OpcionesFkTenant<TTableName extends string, TForeignTableName extends string> {
  /** Las columnas de la tabla HIJA: su columna de tenant y la que apunta al padre (ej. `proyecto_id`). */
  columnas: {
    tenant: AnyPgColumn<{ tableName: TTableName }>;
    padreId: AnyPgColumn<{ tableName: TTableName }>;
  };
  /** Las columnas `(tenant, id)` de la tabla PADRE — las mismas que se le pasaron a `unicoConTenant` ahí. */
  columnasPadre: {
    tenant: AnyPgColumn<{ tableName: TForeignTableName }>;
    id: AnyPgColumn<{ tableName: TForeignTableName }>;
  };
  /**
   * Nombre de la constraint en Postgres. Si no se pasa, se arma uno propio y
   * corto (ver `nombrePorDefecto` más abajo) — **no** el que arma drizzle
   * por default (concatena tabla + las DOS columnas + tabla padre + las DOS
   * columnas padre + `"_fk"`, y con nombres de tabla/columna realistas eso
   * pasa los 63 caracteres que Postgres permite para un identificador, que
   * trunca en silencio y puede colisionar entre dos FKs distintas).
   */
  nombre?: string;
  /** `"no action"` (el default de Postgres) si no se pasa: borrar el padre falla si tiene hijos, en vez de arrastrarlos. `"cascade"` es un opt-in explícito. */
  onDelete?: UpdateDeleteAction;
  onUpdate?: UpdateDeleteAction;
}

/** El límite real de un identificador en Postgres (`NAMEDATALEN` 64 - 1 para el terminador). */
const LARGO_MAXIMO_IDENTIFICADOR = 63;

/**
 * El nombre por defecto de la FK: `${tablaHija}_${columnaPadreId}_tenant_fk`
 * — corto y suficiente para distinguir cuál FK es (la tabla hija y la
 * columna que apunta al padre), a diferencia del que arma drizzle solo
 * (tabla + las dos columnas + tabla padre + las dos columnas padre).
 *
 * Si aun así supera los 63 caracteres (nombres de tabla/columna largos, algo
 * que sí pasa en catálogos reales), se trunca y se le agrega un hash de 8
 * caracteres — determinístico (mismo nombre de tabla/columna, mismo hash
 * siempre) para que dos `drizzle-kit generate` sucesivos no produzcan
 * migraciones espurias, y necesario para que dos FKs largas que truncan al
 * mismo prefijo no terminen con el MISMO nombre (que Postgres rechazaría al
 * crear la segunda).
 */
function nombrePorDefecto(tablaHija: string, columnaPadreId: AnyPgColumn): string {
  const base = `${tablaHija}_${columnaPadreId.name}_tenant_fk`;
  if (base.length <= LARGO_MAXIMO_IDENTIFICADOR) return base;

  const hash = createHash("sha1").update(base).digest("hex").slice(0, 8);
  const espacioParaBase = LARGO_MAXIMO_IDENTIFICADOR - 1 - hash.length; // 1 = "_" separador
  return `${base.slice(0, espacioParaBase)}_${hash}`;
}

/**
 * La FK compuesta `(tenant, padreId) → padre(tenant, id)` que hace que
 * Postgres RECHACE que una fila hija apunte al padre de otra organización
 * (spec 06 §3.1, regla 2) — sin esto, una FK simple sobre `padreId` deja
 * pasar perfecto una fila con `tenant = B` que referencia un padre de
 * `tenant = A`, porque Postgres solo mira que el `id` exista en algún lado,
 * no de quién es.
 *
 * La tabla padre necesita el índice único `unicoConTenant({ tenant, id })`
 * — Postgres exige que toda FK apunte a una clave (primary key o unique) de
 * la tabla referenciada, y `(tenant, id)` como PAR no es una por sí sola
 * aunque `id` ya sea primary key.
 *
 * Va en el `extraConfig` de la tabla hija. El default (sin `onDelete`) es
 * `"no action"`, el mismo default de Postgres: borrar un proyecto con
 * unidades falla en vez de arrastrarlas. `onDelete: "cascade"` es un opt-in
 * explícito para cuando el borrado en cascada es lo que la app quiere:
 *
 * ```ts
 * import { pgTable, uuid, text } from "drizzle-orm/pg-core";
 * import { columnaTenant, fkTenant } from "@mafesoftware/tenant/drizzle";
 * import { proyectos } from "./proyectos.js";
 *
 * export const unidades = pgTable(
 *   "unidades",
 *   {
 *     id: uuid("id").primaryKey(),
 *     organizacionId: columnaTenant(),
 *     proyectoId: uuid("proyecto_id").notNull(),
 *     nombre: text("nombre").notNull(),
 *   },
 *   (t) => [
 *     fkTenant({
 *       columnas: { tenant: t.organizacionId, padreId: t.proyectoId },
 *       columnasPadre: { tenant: proyectos.organizacionId, id: proyectos.id },
 *     }),
 *   ],
 * );
 *
 * // Si en cambio "unidades" no tiene sentido sin su proyecto y querés que
 * // borrar el proyecto se lleve sus unidades:
 * //   fkTenant({ ..., onDelete: "cascade" })
 * ```
 *
 * Con esto, `insert into unidades (organizacion_id, proyecto_id, ...)
 * values ('org-B', '<id de un proyecto de org-A>', ...)` falla con
 * `foreign_key_violation` (código `23503`) en vez de guardar silenciosamente
 * una unidad que cruza organizaciones.
 */
export function fkTenant<TTableName extends string, TForeignTableName extends string>(
  opciones: OpcionesFkTenant<TTableName, TForeignTableName>,
): ForeignKeyBuilder {
  const nombre =
    opciones.nombre ?? nombrePorDefecto(getTableName(opciones.columnas.tenant.table), opciones.columnas.padreId);

  return foreignKey({
    name: nombre,
    columns: [opciones.columnas.tenant, opciones.columnas.padreId],
    foreignColumns: [opciones.columnasPadre.tenant, opciones.columnasPadre.id],
  })
    .onDelete(opciones.onDelete ?? "no action")
    .onUpdate(opciones.onUpdate ?? "no action");
}
