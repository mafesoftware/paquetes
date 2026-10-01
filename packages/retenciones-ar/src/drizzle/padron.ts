import { date, numeric, pgTable, text, timestamp, uniqueIndex, type AnyPgColumn, type PgColumnBuilderBase, type PgTable } from "drizzle-orm/pg-core";
import { columnaTenant, type TipoColumnaTenant } from "@mafesoftware/tenant/drizzle";

/** Opciones de `tablaPadronIibb`. */
export interface OpcionesTablaPadronIibb {
  /** Nombre y tipo de la columna de tenant — mismos defaults que `columnaTenant` (`"organizacion_id"`, `uuid`). */
  tenant?: { columna?: string; tipo?: TipoColumnaTenant };
  /** Nombre de la tabla. `"padron_iibb"` por defecto. */
  nombre?: string;
  /** Columnas propias de la app, además de las de este paquete (ej. una FK a una tabla de importaciones). Constructores de columna de Drizzle, no columnas ya construidas. */
  columnasExtra?: Record<string, PgColumnBuilderBase>;
}

/** Las columnas que `elegirAlicuotaVigente` (núcleo) necesita de cualquier tabla armada con `tablaPadronIibb`. */
export interface ColumnasPadronIibb {
  tenantId: AnyPgColumn;
  jurisdiccion: AnyPgColumn;
  periodo: AnyPgColumn;
  cuit: AnyPgColumn;
  tipo: AnyPgColumn;
  alicuota: AnyPgColumn;
  vigenteDesde: AnyPgColumn;
  vigenteHasta: AnyPgColumn;
  grupo: AnyPgColumn;
  razonSocialContribuyente: AnyPgColumn;
}

/** Lo que devuelve `tablaPadronIibb`: una tabla de Drizzle real, con estas columnas garantizadas. */
export type TablaPadronIibb = PgTable & ColumnasPadronIibb;

/**
 * Una tabla para guardar el padrón de IIBB (ARBA/AGIP) importado, por
 * tenant: una fila por `(jurisdicción, período, CUIT, tipo)`. Pensada para
 * un "swap" por período dentro de una transacción (borrar las filas
 * vigentes de ese `(jurisdiccion, periodo)` e insertar las nuevas), así una
 * reimportación del mismo período es idempotente sin arrastrar filas
 * viejas — ese swap lo hace la app, este paquete solo da la forma de la
 * tabla.
 *
 * Columnas:
 * - la de tenant (`columnaTenant` de `@mafesoftware/tenant/drizzle`).
 * - `jurisdiccion` (`text`, `NOT NULL`): `"ARBA" | "AGIP"` (`Jurisdiccion`
 *   del núcleo, abierto a otras jurisdicciones sin migrar el enum).
 * - `periodo` (`text`, `NOT NULL`): `YYYY-MM`, el período que publicó el
 *   organismo (no la fecha de vigencia de la fila).
 * - `cuit` / `tipo` (`text`, `NOT NULL`): `tipo` es `"retencion" |
 *   "percepcion"` (`TipoPadron` del núcleo).
 * - `alicuota` (`numeric(11, 8)`, `NOT NULL`): string decimal, nunca
 *   `number` — mismo criterio que el resto de los porcentajes exactos de
 *   `@mafesoftware/plata-ar`.
 * - `vigente_desde` (`date`, `NOT NULL`) / `vigente_hasta` (`date`,
 *   nullable: `null` = sin fin).
 * - `grupo` / `razon_social_contribuyente` (`text`, nullable).
 * - `creado_en`/`actualizado_en` (`timestamptz`, `NOT NULL`,
 *   `defaultNow()`).
 *
 * **Catálogo compartido por plataforma vs. importado por una organización
 * puntual** (una org importa su propio padrón solo cuando plataforma
 * todavía no cargó ese período): esa distinción no la resuelve esta
 * factory (`columnaTenant` es siempre `NOT NULL`, spec de
 * `@mafesoftware/tenant`). Una app que la necesite arma un catálogo
 * separado sin columna de tenant (`pgTable` a mano, con las mismas
 * columnas) para el padrón de plataforma, y usa `tablaPadronIibb` para los
 * overrides por organización — o replica el padrón de plataforma como una
 * fila por tenant si prefiere una sola tabla.
 *
 * ```ts
 * import { tablaPadronIibb } from "@mafesoftware/retenciones-ar/drizzle";
 *
 * export const padronIibb = tablaPadronIibb();
 * ```
 */
export function tablaPadronIibb(opciones: OpcionesTablaPadronIibb = {}): TablaPadronIibb {
  const nombre = opciones.nombre ?? "padron_iibb";
  const columnasExtra = opciones.columnasExtra ?? {};

  const tabla = pgTable(
    nombre,
    {
      tenantId: columnaTenant(opciones.tenant?.columna, opciones.tenant?.tipo),
      jurisdiccion: text("jurisdiccion").notNull(),
      periodo: text("periodo").notNull(),
      cuit: text("cuit").notNull(),
      tipo: text("tipo").notNull(),
      alicuota: numeric("alicuota", { precision: 11, scale: 8 }).notNull(),
      vigenteDesde: date("vigente_desde").notNull(),
      vigenteHasta: date("vigente_hasta"),
      grupo: text("grupo"),
      razonSocialContribuyente: text("razon_social_contribuyente"),
      creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
      actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
      ...columnasExtra,
    },
    (t) => [uniqueIndex(`${nombre}_fila_unique`).on(t.tenantId, t.jurisdiccion, t.periodo, t.cuit, t.tipo)],
  );

  return tabla as unknown as TablaPadronIibb;
}
