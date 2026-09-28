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

/** Opciones de `tablaValoresIndice`. */
export interface OpcionesTablaValoresIndice {
  /** Nombre y tipo de la columna de tenant. `"organizacion_id"`/`uuid` por defecto — NULLABLE (ver `columnaTenantOpcional`). */
  tenant?: { columna?: string; tipo?: TipoColumnaTenant };
  /** Nombre de la tabla. `"valores_indice"` por defecto. */
  nombre?: string;
  /** Columnas propias de la app, además de las de este paquete. Constructores de columna de Drizzle, no columnas ya construidas. */
  columnasExtra?: Record<string, PgColumnBuilderBase>;
}

/** Las columnas que garantiza cualquier tabla armada con `tablaValoresIndice`. */
export interface ColumnasValoresIndice {
  id: AnyPgColumn;
  tenantId: AnyPgColumn;
  indice: AnyPgColumn;
  periodo: AnyPgColumn;
  valor: AnyPgColumn;
  estado: AnyPgColumn;
  fechaPublicacion: AnyPgColumn;
  fuente: AnyPgColumn;
  creadoEn: AnyPgColumn;
  actualizadoEn: AnyPgColumn;
}

/** Lo que devuelve `tablaValoresIndice`: una tabla de Drizzle real, con estas columnas garantizadas. */
export type TablaValoresIndice = PgTable & ColumnasValoresIndice;

/**
 * El valor mensual (o el override de una organización) de un índice, para
 * un período dado (spec 02 §3.1): "Cada valor de índice mensual tiene
 * período, valor, estado (provisorio | definitivo), fecha de publicación,
 * fuente... La plataforma mantiene los índices globales; una organización
 * puede fijar su propio valor para un período (queda como override
 * auditado)".
 *
 * Columnas:
 * - `id` (`uuid`, PK, `defaultRandom()`).
 * - la de tenant (`columnaTenantOpcional`): **NULLABLE** — `NULL` es el
 *   valor GLOBAL de la plataforma, un `uuid`/`text` concreto es el override
 *   de ESA organización para ese `(indice, periodo)`. Ver `valorVigente`
 *   para cómo se resuelve cuál gana.
 * - `indice` (`text`, `NOT NULL`): el código del índice (`tablaIndices.codigo`,
 *   sin FK forzada acá — cada app decide si la agrega).
 * - `periodo` (`text`, `NOT NULL`): `"YYYY-MM"` (spec 02 §6).
 * - `valor` (`numeric(20,8)`, `NOT NULL`, `mode: "string"`): el valor
 *   publicado, como STRING — nunca `number`, para no perder precisión al
 *   leerlo de vuelta (es justo lo que espera `factorEntre`/`calcularAjuste`).
 * - `estado` (`text`, `NOT NULL`): `"provisorio" | "definitivo"`.
 * - `fecha_publicacion` (`date`, `NOT NULL`): día de calendario (spec 02
 *   §6), no instante.
 * - `fuente` (`text`, `NOT NULL`): de dónde salió este valor concreto
 *   (`"bcra"`, `"manual"`, `"cac"`...) — puede diferir de `tablaIndices.fuente`
 *   si, por ejemplo, la lectura automática falló y se cargó a mano.
 * - `creado_en`/`actualizado_en` (`timestamptz`, `NOT NULL`, `defaultNow()`).
 *
 * **Dos índices únicos PARCIALES** en vez de uno solo sobre `(tenant,
 * indice, periodo)`: un único índice normal NO alcanza acá, porque Postgres
 * trata cada `NULL` de una columna indexada como distinto de cualquier
 * otro — dos filas GLOBALES (`tenant IS NULL`) del mismo `(indice,
 * periodo)` no chocarían entre sí bajo un único índice "a secas", que es
 * exactamente el caso que hay que impedir (dos valores globales del mismo
 * período). Con un índice único filtrado por `tenant IS NOT NULL` para los
 * overrides y otro filtrado por `tenant IS NULL` para los globales, cada
 * mitad SÍ se comporta como "una fila por combinación".
 *
 * ```ts
 * import { tablaValoresIndice } from "@mafesoftware/indices-ar/drizzle";
 *
 * export const valoresIndice = tablaValoresIndice();
 * ```
 */
export function tablaValoresIndice(opciones: OpcionesTablaValoresIndice = {}): TablaValoresIndice {
  const nombreTabla = opciones.nombre ?? "valores_indice";
  const columnasExtra = opciones.columnasExtra ?? {};

  const tabla = pgTable(
    nombreTabla,
    {
      id: uuid("id").primaryKey().defaultRandom(),
      tenantId: columnaTenantOpcional(opciones.tenant?.columna, opciones.tenant?.tipo),
      indice: text("indice").notNull(),
      periodo: text("periodo").notNull(),
      valor: numeric("valor", { precision: 20, scale: 8, mode: "string" }).notNull(),
      estado: text("estado").notNull(),
      fechaPublicacion: date("fecha_publicacion").notNull(),
      fuente: text("fuente").notNull(),
      creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
      actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
      ...columnasExtra,
    },
    (t) => [
      uniqueIndex(`${nombreTabla}_tenant_indice_periodo_key`)
        .on(t.tenantId, t.indice, t.periodo)
        .where(sql`${t.tenantId} is not null`),
      uniqueIndex(`${nombreTabla}_global_indice_periodo_key`)
        .on(t.indice, t.periodo)
        .where(sql`${t.tenantId} is null`),
    ],
  );

  return tabla as unknown as TablaValoresIndice;
}
