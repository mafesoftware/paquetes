import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
  type PgColumnBuilderBase,
  type PgTable,
} from "drizzle-orm/pg-core";
import { columnaTenant, type TipoColumnaTenant } from "@mafesoftware/tenant/drizzle";
import { validarNombreTabla } from "./nombre-tabla.js";

/** Opciones de `tablaAuditoria`. */
export interface OpcionesTablaAuditoria {
  /** Nombre y tipo de la columna de tenant — mismos defaults que `columnaTenant` (`"organizacion_id"`, `uuid`). */
  tenant?: { columna?: string; tipo?: TipoColumnaTenant };
  /** Nombre de la tabla. `"auditoria"` por defecto. */
  nombre?: string;
  /** Columnas propias de la app, además de las de este paquete. Constructores de columna de Drizzle (`text(...)`, `uuid(...).notNull()`, ...), no columnas ya construidas. */
  columnasExtra?: Record<string, PgColumnBuilderBase>;
}

/** Quién hizo el cambio auditado. */
export type ActorTipo = "usuario" | "sistema" | "portal" | "plataforma";

/**
 * Las columnas que `auditar`/`listarAuditoria` necesitan de cualquier tabla
 * armada con `tablaAuditoria` (con o sin `columnasExtra`, con cualquier
 * nombre de columna de tenant).
 */
export interface ColumnasAuditoria {
  id: AnyPgColumn;
  tenantId: AnyPgColumn;
  entidad: AnyPgColumn;
  entidadId: AnyPgColumn;
  accion: AnyPgColumn;
  actorTipo: AnyPgColumn;
  actorId: AnyPgColumn;
  antes: AnyPgColumn;
  despues: AnyPgColumn;
  cambios: AnyPgColumn;
  ip: AnyPgColumn;
  userAgent: AnyPgColumn;
  creadoEn: AnyPgColumn;
}

/** Lo que devuelve `tablaAuditoria`: una tabla de Drizzle real, usable en `.insert()`/`.select()`, con estas columnas garantizadas. */
export type TablaAuditoria = PgTable & ColumnasAuditoria;

/**
 * La tabla de auditoría: una fila por cada cambio auditado, con quién lo
 * hizo, cuándo, y el diff (`cambios`, ya redactado y serializado por
 * `auditar`) además de las fotos completas `antes`/`despues` si se
 * pasaron.
 *
 * Columnas:
 * - `id` (`uuid`, PK, `defaultRandom()` — `gen_random_uuid()` de Postgres).
 * - la de tenant (`columnaTenant` de `@mafesoftware/tenant/drizzle`: nombre
 *   y tipo configurables con `tenant.columna`/`tenant.tipo`).
 * - `entidad`/`entidad_id` (`text`, `NOT NULL`): qué se auditó (ej.
 *   `"producto"`/`"a1b2..."`).
 * - `accion` (`text`, `NOT NULL`): ej. `"crear"`, `"actualizar"`, `"anular"`.
 * - `actor_tipo` (`text`, `NOT NULL`): `"usuario" | "sistema" | "portal" |
 *   "plataforma"` (`ActorTipo`) — quién disparó el cambio, no solo una
 *   persona: un cron, un webhook de un portal externo, o la plataforma
 *   misma (una tarea de mantenimiento) también auditan.
 * - `actor_id` (`text`, nullable): el id de ese actor — puede no haber uno
 *   (una tarea de sistema sin un id de usuario detrás).
 * - `antes`/`despues` (`jsonb`, nullable): la foto completa de la entidad
 *   antes/después, ya redactada y serializada — `null` si no se pasaron
 *   (ver `auditar`).
 * - `cambios` (`jsonb`, `NOT NULL`): el resultado de `loQueCambio` sobre
 *   `antes`/`despues`, redactado y serializado — `[]` si no hubo `antes` ni
 *   `despues`.
 * - `ip`/`user_agent` (`text`, nullable).
 * - `creado_en` (`timestamptz`, `NOT NULL`, `defaultNow()`).
 *
 * Índices (no únicos: una entidad tiene MUCHAS filas de auditoría, una por
 * cambio): `(tenant, entidad, entidad_id, creado_en)` — el historial de UNA
 * entidad puntual, más reciente primero — y `(tenant, creado_en)` — el
 * historial completo de un tenant, para `listarAuditoria` sin filtrar por
 * entidad.
 *
 * **Esta tabla, sola, NO es inmutable** — eso lo agrega `sqlInmutabilidad`
 * (trigger de Postgres), como una migración a mano aparte (ver su JSDoc):
 * `tablaAuditoria` solo arma la forma de la tabla, drizzle-kit no genera
 * triggers.
 *
 * **Valida `nombre`** contra el mismo patrón y tope de largo que
 * `sqlInmutabilidad` (`^[a-z_][a-z0-9_]*$`, máximo 40 caracteres — ver
 * `nombre-tabla.ts`) y TIRA si no pasa: así una tabla que esta función deja
 * crear siempre puede recibir después el trigger de `sqlInmutabilidad`.
 *
 * ```ts
 * import { tablaAuditoria } from "@mafesoftware/auditoria/drizzle";
 *
 * // Con los defaults: tabla "auditoria", columna de tenant "organizacion_id" (uuid).
 * export const auditoria = tablaAuditoria();
 *
 * // Con una columna de tenant propia y otro nombre de tabla:
 * export const auditoriaDeFacturacion = tablaAuditoria({
 *   tenant: { columna: "club_id", tipo: "text" },
 *   nombre: "auditoria_facturacion",
 * });
 *
 * tablaAuditoria({ nombre: "Auditoria" }); // tira: nombre inválido (mayúscula)
 * ```
 */
export function tablaAuditoria(opciones: OpcionesTablaAuditoria = {}): TablaAuditoria {
  const nombre = opciones.nombre ?? "auditoria";
  // Misma validación (regex + tope de 40 caracteres) que `sqlInmutabilidad`
  // — ver `nombre-tabla.ts` — para que una tabla que `tablaAuditoria` deja
  // crear pueda recibir después el trigger de `sqlInmutabilidad` sin que
  // ESE la rechace por separado (antes de esto, `tablaAuditoria` no
  // validaba `nombre` en absoluto).
  validarNombreTabla(nombre, "tablaAuditoria");
  const columnasExtra = opciones.columnasExtra ?? {};

  const tabla = pgTable(
    nombre,
    {
      id: uuid("id").primaryKey().defaultRandom(),
      tenantId: columnaTenant(opciones.tenant?.columna, opciones.tenant?.tipo),
      entidad: text("entidad").notNull(),
      entidadId: text("entidad_id").notNull(),
      accion: text("accion").notNull(),
      actorTipo: text("actor_tipo").notNull(),
      actorId: text("actor_id"),
      antes: jsonb("antes"),
      despues: jsonb("despues"),
      cambios: jsonb("cambios").notNull(),
      ip: text("ip"),
      userAgent: text("user_agent"),
      creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
      ...columnasExtra,
    },
    (t) => [
      index(`${nombre}_tenant_entidad_idx`).on(t.tenantId, t.entidad, t.entidadId, t.creadoEn),
      index(`${nombre}_tenant_creado_idx`).on(t.tenantId, t.creadoEn),
    ],
  );

  return tabla as unknown as TablaAuditoria;
}
