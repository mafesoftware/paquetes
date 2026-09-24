import { sql, type SQL } from "drizzle-orm";
import type { ActorTipo } from "./tabla.js";
import type { DbCliente } from "./cliente.js";
import type { TablaAuditoria } from "./tabla.js";

/** Filtros/paginación de `listarAuditoria`. Siempre filtra por `tenantId` — no hay forma de listar sin tenant. */
export interface OpcionesListarAuditoria {
  tenantId: string;
  entidad?: string;
  entidadId?: string;
  actorId?: string;
  /** Filtra `creado_en >= desde` (inclusive). */
  desde?: Date;
  /** Filtra `creado_en <= hasta` (inclusive). */
  hasta?: Date;
  /** Base 1. Por defecto `1`. Un valor `< 1` se trata como `1`; `NaN`/`Infinity`/`-Infinity` (ej. un query param sin validar) caen al default, no rompen la consulta. */
  pagina?: number;
  /** Por defecto `50`. Se cap-ea a `200` aunque se pida más; `NaN`/`Infinity`/`-Infinity` caen al default. */
  porPagina?: number;
}

/** Una fila de auditoría tal como la devuelve `listarAuditoria` — mismos nombres de campo en camelCase que las opciones/`EntradaAuditoria`, sin importar cómo se llamen las columnas reales de la tabla (configurables en `tablaAuditoria`). */
export interface FilaAuditoria {
  id: string;
  tenantId: string;
  entidad: string;
  entidadId: string;
  accion: string;
  actorTipo: ActorTipo;
  actorId: string | null;
  antes: unknown;
  despues: unknown;
  cambios: unknown;
  ip: string | null;
  userAgent: string | null;
  creadoEn: Date;
}

export interface ResultadoListarAuditoria {
  filas: FilaAuditoria[];
  /** El total de filas que matchean los filtros, SIN paginar — para armar la UI de paginación (cuántas páginas hay en total). */
  total: number;
}

const PAGINA_POR_DEFECTO = 1;
const POR_PAGINA_POR_DEFECTO = 50;
/** Techo duro de `porPagina`, aunque se pida más — una app no debería poder pedir, por accidente o a propósito, una página de 100.000 filas de auditoría en una sola consulta. */
const POR_PAGINA_MAXIMO = 200;

/**
 * `v` si es un número FINITO (ni `undefined`, ni `NaN`, ni `Infinity`/
 * `-Infinity`), si no `porDefecto`. Sin este chequeo, `Math.trunc(NaN)` da
 * `NaN` y `Math.max(1, NaN)` da `NaN` — un `pagina`/`porPagina` que llegara
 * `NaN` (ej. `Number(query.pagina)` sobre un string no numérico de la URL,
 * sin validar antes) terminaba armando `LIMIT NaN OFFSET NaN` en el SQL,
 * que Postgres rechaza con un error de sintaxis en vez de simplemente
 * paginar con los defaults. `Infinity` tenía el mismo problema
 * (`Math.trunc(Infinity)` es `Infinity`, no finito, mismo resultado en el
 * SQL).
 */
function numeroFinito(v: number | undefined, porDefecto: number): number {
  return v !== undefined && Number.isFinite(v) ? v : porDefecto;
}

/**
 * Lista filas de auditoría de UN tenant (siempre filtrado por `tenantId`,
 * nunca opcional — no hay "listar de todos los tenants"), con filtros
 * opcionales por entidad/actor/rango de fechas, paginado.
 *
 * Siempre ordenado por `creado_en DESC, id DESC` (más reciente primero; el
 * `id` como desempate determinístico entre filas con el mismo
 * `creado_en` exacto, que en un registro de auditoría con mucho volumen no
 * es un caso raro).
 *
 * `porPagina` se cap-ea a `200` aunque se pida más (ver `POR_PAGINA_MAXIMO`
 * más arriba); `pagina` es base 1 y un valor `< 1` se trata como `1`.
 * **`pagina`/`porPagina` que lleguen `NaN`/`Infinity`/`-Infinity` (típico de
 * `Number(queryParam)` sobre un string no numérico, sin validar antes) caen
 * a sus defaults** en vez de armar un `LIMIT`/`OFFSET` inválido — antes de
 * este chequeo, un `pagina: NaN` llegaba tal cual hasta el SQL
 * (`Math.trunc(NaN)` es `NaN`) y Postgres rechazaba la consulta entera con
 * un error de sintaxis.
 *
 * SQL crudo (no `.select().from(tabla)` del query builder), mismo motivo
 * que `auditar`: el tipo público `TablaAuditoria` es un cast ancho para
 * aceptar cualquier tabla armada con `tablaAuditoria` (columna/tipo de
 * tenant propios, `columnasExtra`), y no trae la forma exacta que el query
 * builder necesita para tipar `.select()` en tiempo de compilación. Cada
 * fila devuelta usa los nombres de campo en camelCase de `FilaAuditoria`
 * (vía alias en el `SELECT`), no los nombres reales de columna de la tabla
 * — así una app no necesita saber si la tabla usa `entidad_id` o cualquier
 * otro nombre de columna.
 *
 * ```ts
 * import { listarAuditoria } from "@mafesoftware/auditoria/drizzle";
 *
 * const { filas, total } = await listarAuditoria(db, auditoria, {
 *   tenantId,
 *   entidad: "producto",
 *   entidadId: productoId,
 *   pagina: 1,
 *   porPagina: 20,
 * });
 *
 * // Rango de fechas, sin filtrar por entidad (todo el historial del tenant):
 * const { filas: ultimoMes } = await listarAuditoria(db, auditoria, {
 *   tenantId,
 *   desde: new Date("2026-08-01T00:00:00.000Z"),
 *   hasta: new Date("2026-08-31T23:59:59.999Z"),
 * });
 * ```
 */
export async function listarAuditoria(
  db: DbCliente,
  tabla: TablaAuditoria,
  opciones: OpcionesListarAuditoria,
): Promise<ResultadoListarAuditoria> {
  const pagina = Math.max(1, Math.trunc(numeroFinito(opciones.pagina, PAGINA_POR_DEFECTO)));
  const porPagina = Math.min(POR_PAGINA_MAXIMO, Math.max(1, Math.trunc(numeroFinito(opciones.porPagina, POR_PAGINA_POR_DEFECTO))));
  const offset = (pagina - 1) * porPagina;

  const colId = sql.identifier(tabla.id.name);
  const colTenant = sql.identifier(tabla.tenantId.name);
  const colEntidad = sql.identifier(tabla.entidad.name);
  const colEntidadId = sql.identifier(tabla.entidadId.name);
  const colAccion = sql.identifier(tabla.accion.name);
  const colActorTipo = sql.identifier(tabla.actorTipo.name);
  const colActorId = sql.identifier(tabla.actorId.name);
  const colAntes = sql.identifier(tabla.antes.name);
  const colDespues = sql.identifier(tabla.despues.name);
  const colCambios = sql.identifier(tabla.cambios.name);
  const colIp = sql.identifier(tabla.ip.name);
  const colUserAgent = sql.identifier(tabla.userAgent.name);
  const colCreadoEn = sql.identifier(tabla.creadoEn.name);

  const condiciones: SQL[] = [sql`${colTenant} = ${opciones.tenantId}`];
  if (opciones.entidad !== undefined) condiciones.push(sql`${colEntidad} = ${opciones.entidad}`);
  if (opciones.entidadId !== undefined) condiciones.push(sql`${colEntidadId} = ${opciones.entidadId}`);
  if (opciones.actorId !== undefined) condiciones.push(sql`${colActorId} = ${opciones.actorId}`);
  if (opciones.desde !== undefined) condiciones.push(sql`${colCreadoEn} >= ${opciones.desde}`);
  if (opciones.hasta !== undefined) condiciones.push(sql`${colCreadoEn} <= ${opciones.hasta}`);
  const donde = sql.join(condiciones, sql` and `);

  const consultaFilas = sql`
    select
      ${colId} as id, ${colTenant} as "tenantId", ${colEntidad} as entidad, ${colEntidadId} as "entidadId",
      ${colAccion} as accion, ${colActorTipo} as "actorTipo", ${colActorId} as "actorId",
      ${colAntes} as antes, ${colDespues} as despues, ${colCambios} as cambios,
      ${colIp} as ip, ${colUserAgent} as "userAgent", ${colCreadoEn} as "creadoEn"
    from ${tabla}
    where ${donde}
    order by ${colCreadoEn} desc, ${colId} desc
    limit ${porPagina} offset ${offset}
  `;
  const consultaTotal = sql`select count(*)::bigint as total from ${tabla} where ${donde}`;

  const [resultadoFilas, resultadoTotal] = await Promise.all([
    db.execute(consultaFilas) as unknown as Promise<{ rows: FilaAuditoria[] }>,
    db.execute(consultaTotal) as unknown as Promise<{ rows: { total: string }[] }>,
  ]);

  return {
    filas: resultadoFilas.rows,
    total: Number(resultadoTotal.rows[0]?.total ?? 0),
  };
}
