import { sql } from "drizzle-orm";
import type { DbCliente } from "./cliente.js";
import type { TablaValoresIndice } from "./tabla-valores-indice.js";

/** Opciones de `valorVigente`. */
export interface OpcionesValorVigente {
  /** `null`/`undefined`: solo se busca el valor GLOBAL (`tenantId is null`). */
  tenantId?: string | null;
  indice: string;
  periodo: string;
}

/** Lo que devuelve `valorVigente`. */
export interface ValorVigente {
  valor: string;
  estado: "provisorio" | "definitivo";
  fechaPublicacion: string;
  fuente: string;
  /** `null` si la fila que ganó es la GLOBAL; el id de la organización si es su override. */
  tenantId: string | null;
}

/** La forma cruda de la fila que devuelve la consulta SQL (los nombres de columna van con el alias fijo de la consulta, no con los de `tabla`). */
interface FilaValorVigente {
  valor: string;
  estado: string;
  fecha_publicacion: string;
  fuente: string;
  tenant_id: string | null;
}

/**
 * El valor VIGENTE de un índice para un `(indice, periodo)`: el override de
 * `tenantId` si existe, si no el valor GLOBAL de la plataforma (spec 02
 * §3.1: "La plataforma mantiene los índices globales; una organización
 * puede fijar su propio valor para un período").
 *
 * Sin `tenantId` (o con `null`), busca DIRECTAMENTE el global — útil para
 * un panel de plataforma que no está mirando desde ninguna organización en
 * particular.
 *
 * No exige transacción (es una lectura): acepta el `db` de nivel superior o
 * una `tx`.
 *
 * ```ts
 * import { valorVigente } from "@mafesoftware/indices-ar/drizzle";
 *
 * const v = await valorVigente(db, valoresIndice, { tenantId, indice: "UVA", periodo: "2026-09" });
 * // v?.tenantId === tenantId si esa organización cargó un override para
 * // "2026-09"; si no, v?.tenantId === null (el valor global de la
 * // plataforma) o v === null si no hay NINGUNO de los dos todavía.
 * ```
 */
export async function valorVigente(
  db: DbCliente,
  tabla: TablaValoresIndice,
  opciones: OpcionesValorVigente,
): Promise<ValorVigente | null> {
  const colTenant = sql.identifier(tabla.tenantId.name);
  const colIndice = sql.identifier(tabla.indice.name);
  const colPeriodo = sql.identifier(tabla.periodo.name);
  const colValor = sql.identifier(tabla.valor.name);
  const colEstado = sql.identifier(tabla.estado.name);
  const colFechaPublicacion = sql.identifier(tabla.fechaPublicacion.name);
  const colFuente = sql.identifier(tabla.fuente.name);

  const condicionTenant = opciones.tenantId
    ? sql`(${colTenant} = ${opciones.tenantId} or ${colTenant} is null)`
    : sql`${colTenant} is null`;

  const consulta = sql`
    select
      ${colValor} as valor,
      ${colEstado} as estado,
      ${colFechaPublicacion}::text as fecha_publicacion,
      ${colFuente} as fuente,
      ${colTenant}::text as tenant_id
    from ${tabla}
    where ${condicionTenant} and ${colIndice} = ${opciones.indice} and ${colPeriodo} = ${opciones.periodo}
    order by (${colTenant} is null) asc
    limit 1
  `;

  const resultado = (await db.execute(consulta)) as unknown as { rows: FilaValorVigente[] };
  const fila = resultado.rows[0];
  if (!fila) return null;

  return {
    valor: fila.valor,
    estado: fila.estado as "provisorio" | "definitivo",
    fechaPublicacion: fila.fecha_publicacion,
    fuente: fila.fuente,
    tenantId: fila.tenant_id,
  };
}
