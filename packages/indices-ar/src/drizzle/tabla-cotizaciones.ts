import { sql } from "drizzle-orm";
import {
  date,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgColumnBuilderBase,
  type PgTable,
} from "drizzle-orm/pg-core";
import { columnaTenantOpcional, type TipoColumnaTenant } from "./columna-tenant-opcional.js";

/** Opciones de `tablaCotizaciones`. */
export interface OpcionesTablaCotizaciones {
  /** Nombre y tipo de la columna de tenant. `"organizacion_id"`/`uuid` por defecto — NULLABLE (ver `columnaTenantOpcional`). */
  tenant?: { columna?: string; tipo?: TipoColumnaTenant };
  /** Nombre de la tabla. `"cotizaciones"` por defecto. */
  nombre?: string;
  /** Columnas propias de la app, además de las de este paquete. Constructores de columna de Drizzle, no columnas ya construidas. */
  columnasExtra?: Record<string, PgColumnBuilderBase>;
}

/** Las columnas que garantiza cualquier tabla armada con `tablaCotizaciones`. */
export interface ColumnasCotizaciones {
  id: AnyPgColumn;
  tenantId: AnyPgColumn;
  fecha: AnyPgColumn;
  fuente: AnyPgColumn;
  compra: AnyPgColumn;
  venta: AnyPgColumn;
  creadoEn: AnyPgColumn;
  actualizadoEn: AnyPgColumn;
}

/** Lo que devuelve `tablaCotizaciones`: una tabla de Drizzle real, con estas columnas garantizadas. */
export type TablaCotizaciones = PgTable & ColumnasCotizaciones;

/**
 * Cotizaciones diarias de moneda (spec 02 §2): "Tabla cotizaciones
 * (organización nula = global; o por organización para cargas propias):
 * fecha, fuente, compra, venta. Carga automática diaria por cron desde una
 * API pública... con respaldo manual".
 *
 * Columnas:
 * - `id` (`uuid`, PK, `defaultRandom()`).
 * - la de tenant (`columnaTenantOpcional`): **NULLABLE**, misma convención
 *   que `tablaValoresIndice` — `NULL` es la cotización GLOBAL de la
 *   plataforma (la que trae el cron), un valor concreto es la carga manual
 *   propia de esa organización para ese `(fecha, fuente)`.
 * - `fecha` (`date`, `NOT NULL`): día de calendario.
 * - `fuente` (`text`, `NOT NULL`): `"oficial"`, `"blue"`, `"mep"`, `"ccl"`,
 *   `"manual"`... (spec 02 §2: `fuente_tc`) — texto libre, este paquete no
 *   lo restringe a un enum cerrado.
 * - `compra`/`venta` (`numeric(20,6)`, `NOT NULL`, `mode: "string"`).
 * - `creado_en`/`actualizado_en` (`timestamptz`, `NOT NULL`, `defaultNow()`).
 *
 * Mismos dos índices únicos PARCIALES que `tablaValoresIndice` (ver su
 * JSDoc para el porqué): uno sobre `(tenant, fecha, fuente)` para overrides,
 * otro sobre `(fecha, fuente)` para las filas globales.
 *
 * ```ts
 * import { tablaCotizaciones } from "@mafesoftware/indices-ar/drizzle";
 *
 * export const cotizaciones = tablaCotizaciones();
 * ```
 */
export function tablaCotizaciones(opciones: OpcionesTablaCotizaciones = {}): TablaCotizaciones {
  const nombreTabla = opciones.nombre ?? "cotizaciones";
  const columnasExtra = opciones.columnasExtra ?? {};

  const tabla = pgTable(
    nombreTabla,
    {
      id: uuid("id").primaryKey().defaultRandom(),
      tenantId: columnaTenantOpcional(opciones.tenant?.columna, opciones.tenant?.tipo),
      fecha: date("fecha").notNull(),
      fuente: text("fuente").notNull(),
      compra: numeric("compra", { precision: 20, scale: 6, mode: "string" }).notNull(),
      venta: numeric("venta", { precision: 20, scale: 6, mode: "string" }).notNull(),
      creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
      actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
      ...columnasExtra,
    },
    (t) => [
      uniqueIndex(`${nombreTabla}_tenant_fecha_fuente_key`)
        .on(t.tenantId, t.fecha, t.fuente)
        .where(sql`${t.tenantId} is not null`),
      uniqueIndex(`${nombreTabla}_global_fecha_fuente_key`)
        .on(t.fecha, t.fuente)
        .where(sql`${t.tenantId} is null`),
    ],
  );

  return tabla as unknown as TablaCotizaciones;
}
