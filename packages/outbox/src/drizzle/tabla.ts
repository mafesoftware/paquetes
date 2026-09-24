import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgColumnBuilderBase,
  type PgTable,
} from "drizzle-orm/pg-core";
import { columnaTenant, type TipoColumnaTenant } from "@mafesoftware/tenant/drizzle";

/** Opciones de `tablaOutbox`. */
export interface OpcionesTablaOutbox {
  /** Nombre y tipo de la columna de tenant — mismos defaults que `columnaTenant` (`"organizacion_id"`, `uuid`). */
  tenant?: { columna?: string; tipo?: TipoColumnaTenant };
  /** Nombre de la tabla. `"outbox"` por defecto. */
  nombre?: string;
  /** Columnas propias de la app, además de las de este paquete. Constructores de columna de Drizzle (`text(...)`, `uuid(...).notNull()`, ...), no columnas ya construidas. */
  columnasExtra?: Record<string, PgColumnBuilderBase>;
}

/**
 * Las columnas que `encolar`/`procesarOutbox` necesitan de cualquier tabla
 * armada con `tablaOutbox` (con o sin `columnasExtra`, con cualquier nombre
 * de columna de tenant).
 */
export interface ColumnasOutbox {
  id: AnyPgColumn;
  tenantId: AnyPgColumn;
  canal: AnyPgColumn;
  destino: AnyPgColumn;
  plantilla: AnyPgColumn;
  datos: AnyPgColumn;
  claveIdempotencia: AnyPgColumn;
  estado: AnyPgColumn;
  intentos: AnyPgColumn;
  maxIntentos: AnyPgColumn;
  programadoPara: AnyPgColumn;
  proximoIntentoEn: AnyPgColumn;
  bloqueadoHasta: AnyPgColumn;
  ultimoErrorCategoria: AnyPgColumn;
  ultimoErrorCodigo: AnyPgColumn;
  idExterno: AnyPgColumn;
  enviadoEn: AnyPgColumn;
  creadoEn: AnyPgColumn;
  actualizadoEn: AnyPgColumn;
}

/** Lo que devuelve `tablaOutbox`: una tabla de Drizzle real, usable en `.insert()`/`.select()`, con estas columnas garantizadas. */
export type TablaOutbox = PgTable & ColumnasOutbox;

/**
 * La tabla de la cola: una fila por mensaje (correo o WhatsApp) a mandar,
 * con su estado, cuántas veces se intentó, cuándo corresponde el próximo
 * intento, y el motivo del último error (categorizado, NUNCA el mensaje
 * crudo del proveedor — puede traer datos personales del destinatario).
 *
 * Columnas:
 * - `id` (`uuid`, PK, `defaultRandom()`).
 * - la de tenant (`columnaTenant` de `@mafesoftware/tenant/drizzle`).
 * - `canal` (`text`, `NOT NULL`): `"correo" | "whatsapp"` (`CanalOutbox`).
 * - `destino` (`text`, `NOT NULL`): la dirección de mail o el número de
 *   WhatsApp (E.164 sin `+`, ya normalizado — este paquete no lo valida).
 * - `plantilla` (`text`, `NOT NULL`): qué se manda; el `Transporte` de cada
 *   canal decide qué hacer con este nombre (`render`/`parametrosDe`, ver
 *   `transporteCorreo`/`transporteWhatsApp`).
 * - `datos` (`jsonb`, `NOT NULL`, default `{}`): los datos que la plantilla
 *   necesita — forma libre, este paquete no la interpreta.
 * - `clave_idempotencia` (`text`, `NOT NULL`): para no mandar el mismo
 *   aviso dos veces (ej. `"recordatorio-turno-123"`). Único junto con el
 *   tenant — ver el índice más abajo.
 * - `estado` (`text`, `NOT NULL`, default `"pendiente"`): `EstadoOutbox`
 *   (`"pendiente" | "procesando" | "enviado" | "fallido" | "descartado"`
 *   — ver su JSDoc en el núcleo).
 * - `intentos` (`integer`, `NOT NULL`, default `0`) / `max_intentos`
 *   (`integer`, `NOT NULL`, default `5`).
 * - `programado_para` (`timestamptz`, `NOT NULL`, `defaultNow()`): no se
 *   manda antes de este momento — `defaultNow()` para un envío inmediato,
 *   o un valor futuro para uno agendado (`encolar({ ..., programadoPara })`).
 * - `proximo_intento_en` (`timestamptz`, nullable): cuándo corresponde el
 *   PRÓXIMO intento tras un fallo transitorio — `null` hasta el primer fallo.
 * - `bloqueado_hasta` (`timestamptz`, nullable): vencimiento del lease de
 *   un worker que la tiene en `"procesando"` — `null` si no está
 *   `"procesando"`.
 * - `ultimo_error_categoria` / `ultimo_error_codigo` (`text`, nullable):
 *   la categoría (`"red"`, `"credenciales"`, ...) y el código del último
 *   fallo — **nunca el mensaje de error crudo del proveedor**, que puede
 *   traer el destino o el cuerpo del mensaje.
 * - `id_externo` (`text`, nullable): el id que dio el proveedor al aceptar
 *   el envío.
 * - `enviado_en` (`timestamptz`, nullable) / `creado_en` / `actualizado_en`
 *   (`timestamptz`, `NOT NULL`, `defaultNow()`).
 *
 * **Único índice** `(tenant, clave_idempotencia)`: es lo que hace que el
 * `INSERT ... ON CONFLICT DO NOTHING` de `encolar` sea idempotente. **Índice**
 * (no único) `(estado, proximo_intento_en)`: el que usa la consulta de
 * reclamo de `procesarOutbox` para encontrar rápido las filas
 * `"pendiente"` que ya les toca.
 *
 * ```ts
 * import { tablaOutbox } from "@mafesoftware/outbox/drizzle";
 *
 * // Con los defaults: tabla "outbox", columna de tenant "organizacion_id" (uuid).
 * export const outbox = tablaOutbox();
 *
 * // Con una columna de tenant propia y otro nombre de tabla:
 * export const avisos = tablaOutbox({ tenant: { columna: "club_id", tipo: "text" }, nombre: "avisos" });
 * ```
 */
export function tablaOutbox(opciones: OpcionesTablaOutbox = {}): TablaOutbox {
  const nombre = opciones.nombre ?? "outbox";
  const columnasExtra = opciones.columnasExtra ?? {};

  const tabla = pgTable(
    nombre,
    {
      id: uuid("id").primaryKey().defaultRandom(),
      tenantId: columnaTenant(opciones.tenant?.columna, opciones.tenant?.tipo),
      canal: text("canal").notNull(),
      destino: text("destino").notNull(),
      plantilla: text("plantilla").notNull(),
      datos: jsonb("datos").notNull().default({}),
      claveIdempotencia: text("clave_idempotencia").notNull(),
      estado: text("estado").notNull().default("pendiente"),
      intentos: integer("intentos").notNull().default(0),
      maxIntentos: integer("max_intentos").notNull().default(5),
      programadoPara: timestamp("programado_para", { withTimezone: true }).notNull().defaultNow(),
      proximoIntentoEn: timestamp("proximo_intento_en", { withTimezone: true }),
      bloqueadoHasta: timestamp("bloqueado_hasta", { withTimezone: true }),
      ultimoErrorCategoria: text("ultimo_error_categoria"),
      ultimoErrorCodigo: text("ultimo_error_codigo"),
      idExterno: text("id_externo"),
      enviadoEn: timestamp("enviado_en", { withTimezone: true }),
      creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
      actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
      ...columnasExtra,
    },
    (t) => [
      uniqueIndex(`${nombre}_tenant_clave_idem_key`).on(t.tenantId, t.claveIdempotencia),
      index(`${nombre}_estado_proximo_idx`).on(t.estado, t.proximoIntentoEn),
    ],
  );

  return tabla as unknown as TablaOutbox;
}
