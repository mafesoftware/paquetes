import { integer, pgTable, text, timestamp, type AnyPgColumn, type PgColumnBuilderBase, type PgTable } from "drizzle-orm/pg-core";

/** Opciones de `tablaIntentos`. */
export interface OpcionesTablaIntentos {
  /** Nombre de la tabla. `"limite_intentos"` por defecto. */
  nombre?: string;
  /** Columnas propias de la app, además de las de este paquete. Constructores de columna de Drizzle (`text(...)`, `uuid(...).notNull()`, ...), no columnas ya construidas. */
  columnasExtra?: Record<string, PgColumnBuilderBase>;
}

/**
 * Las columnas que `registrarIntento`/`consultarIntento`/`limpiarIntentos`
 * necesitan de cualquier tabla armada con `tablaIntentos` (con o sin
 * `columnasExtra`).
 */
export interface ColumnasIntentos {
  clave: AnyPgColumn;
  contador: AnyPgColumn;
  ventanaDesde: AnyPgColumn;
  bloqueadoHasta: AnyPgColumn;
  actualizadoEn: AnyPgColumn;
}

/** Lo que devuelve `tablaIntentos`: una tabla de Drizzle real, usable en `.insert()`/`.select()`, con estas columnas garantizadas. */
export type TablaIntentos = PgTable & ColumnasIntentos;

/**
 * La tabla del freno de fuerza bruta: una fila por CLAVE (una cuenta o una
 * IP, ver `claveCuenta`/`claveIp` del núcleo) con su contador de intentos en
 * la ventana actual y, si se pasó de la raya, hasta cuándo queda bloqueada.
 *
 * Columnas:
 * - `clave` (`text`, PRIMARY KEY): `claveCuenta(email)` o `claveIp(ip)` — el
 *   sujeto al que se le cuenta. Un único índice (la PK) es lo que hace
 *   atómico el `INSERT ... ON CONFLICT` de `registrarIntento`.
 * - `contador` (`integer`, `NOT NULL`, default `0`): cuántos intentos
 *   fallidos lleva la ventana ACTUAL (ver `ventana_desde`).
 * - `ventana_desde` (`timestamptz`, `NOT NULL`, `defaultNow()`): cuándo
 *   arrancó la ventana que `contador` está contando. `registrarIntento` la
 *   reinicia sola (junto con `contador`) apenas pasa `ventanaMs` sin que se
 *   haya llegado al `maximo` — así no hace falta ningún cron que "destrabe"
 *   nada.
 * - `bloqueado_hasta` (`timestamptz`, nullable): vencimiento del bloqueo, si
 *   `contador` llegó a `maximo` dentro de la ventana. **No se limpia solo**:
 *   una vez bloqueada, la fila se queda con esta fecha aunque ya haya
 *   pasado — lo que importa es compararla contra "ahora" en el momento de
 *   decidir (`bloqueado_hasta > ahora`), no que el campo vuelva a `null`
 *   apenas expira. Mismo patrón que el freno de gestionflow
 *   (`intentosIngreso.bloqueadoHasta`).
 * - `actualizado_en` (`timestamptz`, `NOT NULL`, `defaultNow()`).
 *
 * ```ts
 * import { tablaIntentos } from "@mafesoftware/limite-intentos/drizzle";
 *
 * // Con los defaults: tabla "limite_intentos".
 * export const limiteIntentos = tablaIntentos();
 *
 * // Con otro nombre de tabla:
 * export const limiteIntentosTienda = tablaIntentos({ nombre: "limite_intentos_tienda" });
 * ```
 */
export function tablaIntentos(opciones: OpcionesTablaIntentos = {}): TablaIntentos {
  const nombre = opciones.nombre ?? "limite_intentos";
  const columnasExtra = opciones.columnasExtra ?? {};

  const tabla = pgTable(nombre, {
    clave: text("clave").primaryKey(),
    contador: integer("contador").notNull().default(0),
    ventanaDesde: timestamp("ventana_desde", { withTimezone: true }).notNull().defaultNow(),
    bloqueadoHasta: timestamp("bloqueado_hasta", { withTimezone: true }),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
    ...columnasExtra,
  });

  return tabla as unknown as TablaIntentos;
}
