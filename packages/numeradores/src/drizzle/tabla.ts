import { sql } from "drizzle-orm";
import {
  bigint,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
  type PgColumnBuilderBase,
  type PgTable,
} from "drizzle-orm/pg-core";
import { columnaTenant, type TipoColumnaTenant } from "@mafesoftware/tenant/drizzle";

/** Opciones de `tablaNumeradores`. */
export interface OpcionesTablaNumeradores {
  /** Nombre y tipo de la columna de tenant — mismos defaults que `columnaTenant` (`"organizacion_id"`, `uuid`). */
  tenant?: { columna?: string; tipo?: TipoColumnaTenant };
  /** Nombre de la tabla. `"numeradores"` por defecto. */
  nombre?: string;
  /** Columnas propias de la app, además de las de este paquete (ej. una FK de auditoría). Constructores de columna de Drizzle (`text(...)`, `uuid(...).notNull()`, ...), no columnas ya construidas. */
  columnasExtra?: Record<string, PgColumnBuilderBase>;
}

/**
 * Las columnas que `siguienteNumero`/`configurarNumerador` necesitan de
 * cualquier tabla armada con `tablaNumeradores` (con o sin `columnasExtra`,
 * con cualquier nombre de columna de tenant).
 */
export interface ColumnasNumeradores {
  tenantId: AnyPgColumn;
  ambito: AnyPgColumn;
  tipo: AnyPgColumn;
  prefijo: AnyPgColumn;
  relleno: AnyPgColumn;
  proximo: AnyPgColumn;
  actualizadoEn: AnyPgColumn;
}

/** Lo que devuelve `tablaNumeradores`: una tabla de Drizzle real, usable en `.insert()`/`.select()`, con estas columnas garantizadas. */
export type TablaNumeradores = PgTable & ColumnasNumeradores;

/**
 * La tabla que guarda, por `(tenant, ambito, tipo)`, el próximo número a
 * entregar — una fila por cada combinación, creada la primera vez que se la
 * pide.
 *
 * Columnas:
 * - la de tenant (`columnaTenant` de `@mafesoftware/tenant/drizzle`: nombre
 *   y tipo configurables con `tenant.columna`/`tenant.tipo`, igual que en
 *   cualquier otra tabla de negocio del producto).
 * - `ambito` (`text`, `NOT NULL`, default `""`): la serie dentro del tenant
 *   (una sucursal, un punto de venta, una caja...). **`""` significa "sin
 *   ámbito"**, no `null` — a propósito: un índice único de Postgres trata
 *   cada `NULL` como distinto de cualquier otro (`(tenant, NULL, "recibo")`
 *   no choca nunca consigo mismo), así que dos filas "sin ámbito" del mismo
 *   tenant y tipo NO chocarían si la columna admitiera `NULL`. Con `""` como
 *   valor fijo, el único índice sí las distingue como la MISMA fila.
 *   `siguienteNumero`/`configurarNumerador` reciben `ambito?: string | null`
 *   y convierten `null`/`undefined` a `""` antes de tocar la base — la app
 *   nunca necesita saber este detalle.
 * - `tipo` (`text`, `NOT NULL`): qué se está numerando (`"recibo"`,
 *   `"orden_pago"`, `"orden_compra"`, ...). Sin default: cada numerador es
 *   explícitamente de un tipo.
 * - `prefijo` (`text`, `NOT NULL`, default `""`) y `relleno` (`integer`,
 *   `NOT NULL`, default `0`): los que usa `formatearNumero` para armar el
 *   texto (`"R-0007"`). Configurables con `configurarNumerador`.
 * - `proximo` (`bigint` modo `"bigint"`, `NOT NULL`, default `1`): el
 *   próximo número a entregar. Lo tocan solo `siguienteNumero` (lo
 *   incrementa) y `configurarNumerador` (lo fija, sin poder bajarlo).
 * - `creadoEn`/`actualizadoEn` (`timestamp` con zona horaria, `NOT NULL`,
 *   `defaultNow()`).
 *
 * Único índice sobre `(tenant, ambito, tipo)`: es lo que hace que el
 * `INSERT ... ON CONFLICT` de `siguienteNumero` sea atómico bajo
 * concurrencia (ver su JSDoc).
 *
 * ```ts
 * import { tablaNumeradores } from "@mafesoftware/numeradores/drizzle";
 *
 * // Con los defaults: tabla "numeradores", columna de tenant "organizacion_id" (uuid).
 * export const numeradores = tablaNumeradores();
 *
 * // Con una columna de tenant propia (ej. "club_id" como text) y otro nombre de tabla:
 * export const numeradoresDeFacturacion = tablaNumeradores({
 *   tenant: { columna: "club_id", tipo: "text" },
 *   nombre: "numeradores_facturacion",
 * });
 * ```
 */
export function tablaNumeradores(opciones: OpcionesTablaNumeradores = {}): TablaNumeradores {
  const nombre = opciones.nombre ?? "numeradores";
  const columnasExtra = opciones.columnasExtra ?? {};

  const tabla = pgTable(
    nombre,
    {
      tenantId: columnaTenant(opciones.tenant?.columna, opciones.tenant?.tipo),
      ambito: text("ambito").notNull().default(""),
      tipo: text("tipo").notNull(),
      prefijo: text("prefijo").notNull().default(""),
      relleno: integer("relleno").notNull().default(0),
      // default(1n): drizzle-kit/api (generateDrizzleJson/generateMigration,
      // usado por los tests de este paquete) arma un snapshot en JSON del
      // esquema para diffearlo, y JSON.stringify no sabe serializar un
      // bigint (`TypeError: Do not know how to serialize a BigInt`). Con el
      // default como expresión SQL (`sql`1``) en vez de un literal bigint de
      // JS, drizzle-kit lo guarda como texto ("1") y Postgres lo interpreta
      // igual al crear la columna.
      proximo: bigint("proximo", { mode: "bigint" }).notNull().default(sql`1`),
      creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
      actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
      ...columnasExtra,
    },
    (t) => [uniqueIndex(`${nombre}_tenant_ambito_tipo_key`).on(t.tenantId, t.ambito, t.tipo)],
  );

  return tabla as unknown as TablaNumeradores;
}
