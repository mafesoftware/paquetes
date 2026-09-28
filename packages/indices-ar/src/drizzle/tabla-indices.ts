import { pgTable, text, type AnyPgColumn, type PgColumnBuilderBase, type PgTable } from "drizzle-orm/pg-core";

/** Opciones de `tablaIndices`. */
export interface OpcionesTablaIndices {
  /** Nombre de la tabla. `"indices"` por defecto. */
  nombre?: string;
  /** Columnas propias de la app, además de las de este paquete. Constructores de columna de Drizzle, no columnas ya construidas. */
  columnasExtra?: Record<string, PgColumnBuilderBase>;
}

/** Las columnas que garantiza cualquier tabla armada con `tablaIndices`. */
export interface ColumnasIndices {
  codigo: AnyPgColumn;
  nombre: AnyPgColumn;
  fuente: AnyPgColumn;
  frecuencia: AnyPgColumn;
}

/** Lo que devuelve `tablaIndices`: una tabla de Drizzle real, con estas columnas garantizadas. */
export type TablaIndices = PgTable & ColumnasIndices;

/**
 * El catálogo de índices soportados por la plataforma (spec 02 §3.1): uno
 * por cada código (`"CAC_GENERAL"`, `"UVA"`, `"ICL"`, un índice propio de
 * una cámara provincial...). Es una tabla GLOBAL de plataforma —sin
 * columna de tenant—: los valores mensuales de cada índice (con su
 * override por organización) viven en `tablaValoresIndice`.
 *
 * Columnas:
 * - `codigo` (`text`, PK): el identificador estable (`"CAC_GENERAL"`,
 *   `"UVA"`, `"CER"`, `"IPC"`, `"ICL"`, o el que elija una organización
 *   para un índice propio).
 * - `nombre` (`text`, `NOT NULL`): el nombre legible (`"CAC Índice
 *   general"`).
 * - `fuente` (`text`, `NOT NULL`): de dónde sale (`"CAC"`, `"INDEC"`,
 *   `"BCRA"`, `"organizacion"`...).
 * - `frecuencia` (`text`, `NOT NULL`): con qué periodicidad se publica
 *   (`"mensual"`, `"diaria"`...) — informativo, este paquete no lo valida
 *   contra un enum cerrado (la lista de fuentes/frecuencias es de la app).
 *
 * ```ts
 * import { tablaIndices } from "@mafesoftware/indices-ar/drizzle";
 *
 * export const indices = tablaIndices();
 * ```
 */
export function tablaIndices(opciones: OpcionesTablaIndices = {}): TablaIndices {
  const nombreTabla = opciones.nombre ?? "indices";
  const columnasExtra = opciones.columnasExtra ?? {};

  const tabla = pgTable(nombreTabla, {
    codigo: text("codigo").primaryKey(),
    nombre: text("nombre").notNull(),
    fuente: text("fuente").notNull(),
    frecuencia: text("frecuencia").notNull(),
    ...columnasExtra,
  });

  return tabla as unknown as TablaIndices;
}
