import { text, uuid } from "drizzle-orm/pg-core";

/** El tipo de columna que guarda el id de tenant: `uuid` (lo normal) o `text` (ids externos/legacy). */
export type TipoColumnaTenant = "uuid" | "text";

/**
 * La columna de tenant de `tablaValoresIndice`/`tablaCotizaciones`,
 * **nullable a propósito** — a diferencia de `columnaTenant` de
 * `@mafesoftware/tenant/drizzle` (siempre `NOT NULL`, porque toda tabla de
 * negocio tiene un dueño).
 *
 * Estas dos tablas son la excepción documentada por spec 02 §3.1: "la
 * plataforma mantiene los índices globales; una organización puede fijar su
 * propio valor para un período (queda como override auditado)". El valor
 * GLOBAL no tiene tenant — `NULL` es ese valor, no una fila sin dueño que se
 * coló sin querer. `valorVigente` (`valor-vigente.ts`) es la única lectura
 * que necesita entender esta convención: el resto del código de una app
 * trata `tenantId: null` como "el valor de la plataforma".
 */
export function columnaTenantOpcional(nombre = "organizacion_id", tipo: TipoColumnaTenant = "uuid") {
  return tipo === "uuid" ? uuid(nombre) : text(nombre);
}
