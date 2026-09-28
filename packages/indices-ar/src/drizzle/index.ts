/**
 * Lo específico de Drizzle: las tres tablas del módulo de índices y la
 * lectura que resuelve el override por tenant. Subpath separado porque
 * `drizzle-orm` es un peerDependency opcional — el núcleo
 * (`@mafesoftware/indices-ar`) no lo necesita y no lo importa.
 *
 * Este paquete NO trae migraciones (spec 06 §3.2): cada app genera las
 * suyas con drizzle-kit a partir de su propio esquema, que usa estas
 * fábricas. Ver `sql/ejemplo.sql` para el DDL equivalente, de referencia
 * para consumidores sin Drizzle.
 *
 * - `tabla-indices.ts`: `tablaIndices` — el catálogo global de índices.
 * - `tabla-valores-indice.ts`: `tablaValoresIndice` — el valor mensual de
 *   cada índice, con override opcional por tenant.
 * - `tabla-cotizaciones.ts`: `tablaCotizaciones` — cotizaciones diarias,
 *   misma convención de override.
 * - `valor-vigente.ts`: `valorVigente` — el override del tenant si existe,
 *   si no el valor global.
 * - `columna-tenant-opcional.ts` / `cliente.ts`: internos (la columna de
 *   tenant NULLABLE y el tipo `DbCliente`), no se re-exportan acá.
 *
 * ```ts
 * import { tablaIndices, tablaValoresIndice, tablaCotizaciones, valorVigente } from "@mafesoftware/indices-ar/drizzle";
 *
 * export const indices = tablaIndices();
 * export const valoresIndice = tablaValoresIndice();
 * export const cotizaciones = tablaCotizaciones();
 *
 * const v = await valorVigente(db, valoresIndice, { tenantId, indice: "UVA", periodo: "2026-09" });
 * ```
 */
export { tablaIndices, type OpcionesTablaIndices, type ColumnasIndices, type TablaIndices } from "./tabla-indices.js";
export {
  tablaValoresIndice,
  type OpcionesTablaValoresIndice,
  type ColumnasValoresIndice,
  type TablaValoresIndice,
} from "./tabla-valores-indice.js";
export {
  tablaCotizaciones,
  type OpcionesTablaCotizaciones,
  type ColumnasCotizaciones,
  type TablaCotizaciones,
} from "./tabla-cotizaciones.js";
export { valorVigente, type OpcionesValorVigente, type ValorVigente } from "./valor-vigente.js";
export type { TipoColumnaTenant } from "./columna-tenant-opcional.js";
export type { DbCliente } from "./cliente.js";
