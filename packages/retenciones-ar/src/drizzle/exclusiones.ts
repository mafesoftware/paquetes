import { date, numeric, pgTable, text, timestamp, type AnyPgColumn, type PgColumnBuilderBase, type PgTable } from "drizzle-orm/pg-core";
import { columnaTenant, type TipoColumnaTenant } from "@mafesoftware/tenant/drizzle";

/** Opciones de `tablaExclusiones`. */
export interface OpcionesTablaExclusiones {
  /** Nombre y tipo de la columna de tenant — mismos defaults que `columnaTenant` (`"organizacion_id"`, `uuid`). */
  tenant?: { columna?: string; tipo?: TipoColumnaTenant };
  /** Nombre de la tabla. `"exclusiones_retencion"` por defecto. */
  nombre?: string;
  /**
   * Columnas propias de la app, además de las de este paquete — en
   * particular, la FK al proveedor/sujeto retenido (`proveedorId:
   * uuid("proveedor_id").notNull()`, con o sin `.references()`/`fkTenant`
   * según el esquema de cada app) y, si corresponde, al adjunto del
   * certificado. Constructores de columna de Drizzle, no columnas ya
   * construidas.
   */
  columnasExtra?: Record<string, PgColumnBuilderBase>;
}

/** Las columnas que `exclusionVigente` (núcleo) necesita de cualquier tabla armada con `tablaExclusiones`. */
export interface ColumnasExclusiones {
  tenantId: AnyPgColumn;
  regimen: AnyPgColumn;
  porcentaje: AnyPgColumn;
  desde: AnyPgColumn;
  hasta: AnyPgColumn;
  certificado: AnyPgColumn;
}

/** Lo que devuelve `tablaExclusiones`: una tabla de Drizzle real, con estas columnas garantizadas. */
export type TablaExclusiones = PgTable & ColumnasExclusiones;

/**
 * Una tabla para guardar certificados de exclusión/no retención de un
 * proveedor (o cualquier sujeto retenido), por tenant. Sin FK al sujeto
 * retenido a propósito — cada app la agrega vía `columnasExtra` (el nombre
 * de esa entidad, y si es `proveedores`/`contribuyentes`/otra cosa, varía
 * de app en app; este paquete no la conoce).
 *
 * Columnas:
 * - la de tenant (`columnaTenant` de `@mafesoftware/tenant/drizzle`).
 * - `regimen` (`text`, `NOT NULL`): `"ganancias" | "iva" | "suss" | "iibb"`
 *   (`Regimen` del núcleo).
 * - `jurisdiccion` (`text`, nullable): solo tiene sentido para `iibb`
 *   (`"ARBA" | "AGIP"` u otra); `null` para los demás regímenes.
 * - `porcentaje` (`numeric(11, 8)`, `NOT NULL`): `100` = exclusión total,
 *   string decimal — mismo criterio que `alicuota` de `tablaPadronIibb`.
 * - `desde` / `hasta` (`date`, `NOT NULL`): vigencia inclusive en ambos
 *   extremos (`exclusionVigente` del núcleo la compara así).
 * - `certificado` (`text`, `NOT NULL`): el número/identificador del
 *   certificado emitido por el organismo.
 * - `archivado_en` (`timestamptz`, nullable): "nada se borra" — un
 *   certificado dado de baja se archiva, no se elimina la fila.
 * - `creado_en`/`actualizado_en` (`timestamptz`, `NOT NULL`,
 *   `defaultNow()`).
 *
 * ```ts
 * import { uuid } from "drizzle-orm/pg-core";
 * import { tablaExclusiones } from "@mafesoftware/retenciones-ar/drizzle";
 *
 * export const exclusiones = tablaExclusiones({
 *   columnasExtra: { proveedorId: uuid("proveedor_id").notNull() },
 * });
 * ```
 */
export function tablaExclusiones(opciones: OpcionesTablaExclusiones = {}): TablaExclusiones {
  const nombre = opciones.nombre ?? "exclusiones_retencion";
  const columnasExtra = opciones.columnasExtra ?? {};

  const tabla = pgTable(nombre, {
    tenantId: columnaTenant(opciones.tenant?.columna, opciones.tenant?.tipo),
    regimen: text("regimen").notNull(),
    jurisdiccion: text("jurisdiccion"),
    porcentaje: numeric("porcentaje", { precision: 11, scale: 8 }).notNull(),
    desde: date("desde").notNull(),
    hasta: date("hasta").notNull(),
    certificado: text("certificado").notNull(),
    archivadoEn: timestamp("archivado_en", { withTimezone: true }),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
    ...columnasExtra,
  });

  return tabla as unknown as TablaExclusiones;
}
