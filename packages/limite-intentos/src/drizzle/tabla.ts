import { integer, pgTable, text, timestamp, uuid, type AnyPgColumn, type PgColumnBuilderBase, type PgTable } from "drizzle-orm/pg-core";

/** El tipo de columna del tenant OPCIONAL — `uuid` (lo normal) o `text` (ids externos/legacy). Ver `OpcionesTablaIntentos.tenant`. */
export type TipoColumnaTenant = "uuid" | "text";

/** Opciones de `tablaIntentos`. */
export interface OpcionesTablaIntentos {
  /** Nombre de la tabla. `"limite_intentos"` por defecto. */
  nombre?: string;
  /**
   * Agrega una columna de tenant NULLABLE a la tabla — a diferencia de
   * `columnaTenant` de `@mafesoftware/tenant/drizzle` (que otros paquetes
   * de este monorepo, como `outbox`/`numeradores`, usan y que siempre es
   * `NOT NULL`), acá es un campo aparte y **opcional en dos sentidos**:
   *
   * 1. **La COLUMNA no existe si no se pasa esta opción.** Login pasa la
   *    mayoría de las veces SIN tenant conocido todavía (el mail puede
   *    pertenecer a cualquier comercio, o el freno es global — como el
   *    `"plataforma:"` de `claveCuenta`/`claveIp` armado por la app), así
   *    que este paquete no puede exigir una columna de tenant en TODA fila
   *    como hacen las tablas de negocio (spec 06 §3.1) — obligaría a la app
   *    a inventar un tenant falso para cada intento sin uno real.
   * 2. **Si se pasa, la columna queda NULLABLE** (nunca `NOT NULL`,
   *    a propósito): ninguna función de este paquete
   *    (`registrarIntento`/`consultarIntento`/`limpiarIntentos`) recibe ni
   *    escribe un `tenantId` — todas operan solo por `clave` (la PK). La
   *    columna existe para que la APP la popule por su cuenta (con su
   *    propio `UPDATE`/`INSERT` fuera de este paquete, por ejemplo cuando sí
   *    conoce el tenant al momento del intento) y pueda después filtrar o
   *    reportar por tenant — nunca para que este paquete decida el freno
   *    por tenant.
   */
  tenant?: { columna?: string; tipo?: TipoColumnaTenant };
  /** Columnas propias de la app, además de las de este paquete. Constructores de columna de Drizzle (`text(...)`, `uuid(...).notNull()`, ...), no columnas ya construidas. */
  columnasExtra?: Record<string, PgColumnBuilderBase>;
}

/**
 * Las columnas que `registrarIntento`/`consultarIntento`/`limpiarIntentos`
 * necesitan de cualquier tabla armada con `tablaIntentos` (con o sin
 * `columnasExtra`, con o sin la columna de tenant opcional).
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
 * - la columna de tenant OPCIONAL (ver `OpcionesTablaIntentos.tenant`) — NO
 *   existe si no se pide, y es NULLABLE si se pide (a diferencia de
 *   `columnaTenant` de `@mafesoftware/tenant/drizzle`).
 *
 * ```ts
 * import { tablaIntentos } from "@mafesoftware/limite-intentos/drizzle";
 *
 * // Con los defaults: tabla "limite_intentos", sin columna de tenant.
 * export const limiteIntentos = tablaIntentos();
 *
 * // Con otro nombre de tabla y una columna de tenant NULLABLE (para reportes):
 * export const limiteIntentosTienda = tablaIntentos({
 *   nombre: "limite_intentos_tienda",
 *   tenant: { columna: "organizacion_id", tipo: "uuid" },
 * });
 * ```
 */
export function tablaIntentos(opciones: OpcionesTablaIntentos = {}): TablaIntentos {
  const nombre = opciones.nombre ?? "limite_intentos";
  const columnasExtra = opciones.columnasExtra ?? {};

  const columnaTenantExtra: Record<string, PgColumnBuilderBase> = opciones.tenant
    ? {
        // Property key fijo ("tenantId"), sin importar cómo se llame la
        // columna en la base (`opciones.tenant.columna`) — mismo criterio
        // que `tenantId` en `ColumnasOutbox`/`ColumnasNumeradores`, así el
        // consumidor que sí quiere tocarla accede siempre por el mismo
        // nombre en JS. NUNCA `.notNull()`: ver el JSDoc de
        // `OpcionesTablaIntentos.tenant`.
        tenantId:
          opciones.tenant.tipo === "text"
            ? text(opciones.tenant.columna ?? "organizacion_id")
            : uuid(opciones.tenant.columna ?? "organizacion_id"),
      }
    : {};

  const tabla = pgTable(nombre, {
    clave: text("clave").primaryKey(),
    contador: integer("contador").notNull().default(0),
    ventanaDesde: timestamp("ventana_desde", { withTimezone: true }).notNull().defaultNow(),
    bloqueadoHasta: timestamp("bloqueado_hasta", { withTimezone: true }),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
    ...columnaTenantExtra,
    ...columnasExtra,
  });

  return tabla as unknown as TablaIntentos;
}
