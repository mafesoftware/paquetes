/**
 * Lo específico de Drizzle: dos factories de tabla genéricas, en el mismo
 * patrón que `@mafesoftware/outbox`/`@mafesoftware/numeradores` —
 * parametrizadas por la columna de tenant (`columnaTenant` de
 * `@mafesoftware/tenant/drizzle`) y con un `columnasExtra` para que la app
 * agregue sus propias FKs. Subpath separado porque `drizzle-orm` es un
 * peerDependency opcional — el núcleo (`@mafesoftware/retenciones-ar`) no
 * lo necesita y no lo importa.
 *
 * Este paquete NO trae migraciones: cada app genera las suyas con
 * drizzle-kit a partir de su propio esquema, que usa estas tablas.
 *
 * - `padron.ts`: `tablaPadronIibb` — el padrón de IIBB (ARBA/AGIP)
 *   importado, por tenant.
 * - `exclusiones.ts`: `tablaExclusiones` — certificados de exclusión/no
 *   retención, por tenant (sin FK al sujeto retenido: la agrega la app vía
 *   `columnasExtra`).
 *
 * Lo que este paquete NO trae un factory para (queda del lado de cada
 * app, porque su forma depende de decisiones propias del dominio: catálogo
 * global de plataforma vs. override por organización, numeración de
 * certificados emitidos, acumulado mensual de Ganancias con bloqueo
 * `FOR UPDATE`, FKs a razones sociales/órdenes de pago): la config de
 * regímenes/alícuotas en sí (`TablaGanancias`/escala/alícuota simple,
 * serializada con `serializarTablaGanancias` del núcleo en una columna
 * `jsonb` propia) y los certificados de retención emitidos al pagar.
 *
 * ```ts
 * import { tablaPadronIibb, tablaExclusiones } from "@mafesoftware/retenciones-ar/drizzle";
 * import { uuid } from "drizzle-orm/pg-core";
 *
 * export const padronIibb = tablaPadronIibb();
 * export const exclusiones = tablaExclusiones({
 *   columnasExtra: { proveedorId: uuid("proveedor_id").notNull() },
 * });
 * ```
 */
export { tablaPadronIibb, type ColumnasPadronIibb, type OpcionesTablaPadronIibb, type TablaPadronIibb } from "./padron.js";
export { tablaExclusiones, type ColumnasExclusiones, type OpcionesTablaExclusiones, type TablaExclusiones } from "./exclusiones.js";
